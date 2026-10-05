package expo.modules.togetherlan

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.Semaphore
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** No identity/authentication here. Consumers must use the signed encrypted channel. */
class TogetherLanModule : Module() {
  private val control = ScheduledThreadPoolExecutor(1).apply {
    removeOnCancelPolicy = true
    setExecuteExistingDelayedTasksAfterShutdownPolicy(false)
  }
  private val io = ThreadPoolExecutor(17, 17, 0, TimeUnit.SECONDS, ArrayBlockingQueue(32))
  private val peerSlots = Semaphore(8)
  private var resolveTimer: ScheduledFuture<*>? = null
  private val peers = mutableMapOf<String, Peer>()
  private val endpoints = mutableMapOf<String, NsdServiceInfo>()
  private val services = mutableMapOf<String, String>()
  private val resolving = ArrayDeque<NsdServiceInfo>()
  private var resolveActive = false
  private var discovery: NsdManager.DiscoveryListener? = null
  private var registration: NsdManager.RegistrationListener? = null
  private var server: ServerSocket? = null
  private var network: Network? = null
  private var hotspotOwner = false
  private var generation = 0
  private val serviceType = "_persist-tg._tcp."

  private class Peer(val socket: Socket) {
    var timer: ScheduledFuture<*>? = null
    var writeTimer: ScheduledFuture<*>? = null
    var frameWindow = System.nanoTime()
    var frameCount = 0
    val writes = ArrayDeque<Pair<ByteArray, Promise>>()
    var ready = false
  }

  private val context get() = requireNotNull(appContext.reactContext)
  private val nsd get() = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val connectivity get() = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  override fun definition() = ModuleDefinition {
    Name("TogetherLan")
    Events("onEvent")
    AsyncFunction("startHost") { lobbyId: String, promise: Promise -> command(promise) { selectTransport(false); host(lobbyId) } }
    AsyncFunction("startHotspotHost") { lobbyId: String, promise: Promise -> command(promise) {
      selectTransport(true); host(lobbyId)
    } }
    AsyncFunction("startHotspotDiscovery") { promise: Promise -> command(promise) {
      selectTransport(true); discover()
    } }
    AsyncFunction("startDiscovery") { promise: Promise -> command(promise) { selectTransport(false); discover() } }
    AsyncFunction("connect") { endpointId: String, promise: Promise -> command(promise) { connect(endpointId) } }
    AsyncFunction("send") { peerId: String, frame: String, promise: Promise ->
      if (!post {
        val peer = peers[peerId]
        val bytes = frame.toByteArray(Charsets.UTF_8)
        if (peer == null || !peer.ready) promise.reject("not_connected", "Peer is not connected", null)
        else if (bytes.isEmpty() || bytes.size > 65_536 || peer.writes.size >= 16)
          promise.reject("frame_limit", "Frame or pending-write limit exceeded", null)
        else {
          peer.writes.addLast(bytes to promise)
          if (peer.writes.size == 1) writeNext(peerId, peer)
        }
      }) promise.reject("module_destroyed", "LAN module is destroyed", null)
    }
    AsyncFunction("disconnect") { peerId: String, promise: Promise -> command(promise) { drop(peerId) } }
    AsyncFunction("stop") { promise: Promise -> command(promise) { stopAll() } }
    OnDestroy {
      post { stopAll(); io.shutdownNow(); control.shutdown() }
    }
  }

  private fun post(action: () -> Unit): Boolean = try {
    control.execute(action); true
  } catch (_: RejectedExecutionException) { false }

  private fun command(promise: Promise, action: () -> Unit) {
    if (!post {
      try { action(); promise.resolve(null) }
      catch (error: Exception) { promise.reject("lan_unavailable", error.message, error) }
    }) promise.reject("module_destroyed", "LAN module is destroyed", null)
  }

  private fun emit(vararg fields: Pair<String, Any>) { sendEvent("onEvent", mapOf(*fields)) }

  private fun wifi(): Network {
    network?.let { existing ->
      check(connectivity.getNetworkCapabilities(existing)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) { "wifi_lost" }
      return existing
    }
    return connectivity.allNetworks.firstOrNull {
      connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    }?.also { network = it } ?: error("wifi_unavailable")
  }

  /** Explicit opt-in only. Never guesses an AP interface name or falls back from Wi-Fi. */
  private fun selectTransport(owner: Boolean) {
    check(server == null && discovery == null && peers.isEmpty()) { "stop_before_transport_change" }
    hotspotOwner = owner
  }
  private fun localOnly(address: InetAddress): Boolean {
    if (address.isLoopbackAddress || address.isAnyLocalAddress || address.isMulticastAddress) return false
    val bytes = address.address
    // Java site-local covers RFC1918 IPv4; include IPv6 ULA and link-local.
    return address.isSiteLocalAddress || address.isLinkLocalAddress ||
      (bytes.size == 16 && (bytes[0].toInt() and 0xfe) == 0xfc)
  }
  private fun samePrefix(a: InetAddress, b: InetAddress, prefix: Int): Boolean {
    val left = a.address; val right = b.address
    return left.size == right.size && prefix in 1..(left.size * 8) &&
      (0 until prefix).all { bit -> ((left[bit / 8].toInt() xor right[bit / 8].toInt()) and (1 shl (7 - bit % 8))) == 0 }
  }
  private fun ownerAllowedAddress(local: InetAddress): Boolean {
    // An AP-owned interface need not have a Network. Never use a known cellular,
    // VPN or other non-Wi-Fi Network merely because its address is private.
    return connectivity.allNetworks.none { candidate ->
      val capabilities = connectivity.getNetworkCapabilities(candidate)
      connectivity.getLinkProperties(candidate)?.linkAddresses?.any { it.address == local } == true &&
        (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) != true ||
          capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true ||
          capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
    }
  }
  private fun ownerRoute(local: InetAddress, remote: InetAddress): Boolean = runCatching {
    if (!localOnly(local) || !localOnly(remote) || !ownerAllowedAddress(local)) return@runCatching false
    val actual = NetworkInterface.getByInetAddress(local) ?: return@runCatching false
    actual.isUp && !actual.isLoopback && !actual.isPointToPoint && actual.interfaceAddresses.any {
      it.address == local && samePrefix(local, remote, it.networkPrefixLength.toInt())
    }
  }.getOrDefault(false)
  private fun ownerAddress(remote: InetAddress): InetAddress? = runCatching {
    if (!localOnly(remote)) return@runCatching null
    // Only directly connected local subnets, selected from a resolved NSD endpoint.
    // A private address alone is insufficient; VPN point-to-point routes are rejected.
    NetworkInterface.getNetworkInterfaces().toList().asSequence()
      .filter { it.isUp && !it.isLoopback && !it.isPointToPoint }
      .flatMap { it.interfaceAddresses.asSequence() }
      .firstOrNull { localOnly(it.address) && ownerAllowedAddress(it.address) && samePrefix(it.address, remote, it.networkPrefixLength.toInt()) }?.address
  }.getOrNull()

  private fun validLobby(value: String): Boolean = try { UUID.fromString(value).toString() == value } catch (_: Exception) { false }

  private fun host(lobbyId: String) {
    check(validLobby(lobbyId)) { "invalid_lobby" }
    check(server == null) { "already_hosting" }
    val localNetwork = if (hotspotOwner) null else wifi()
    if (localNetwork != null) check(connectivity.getLinkProperties(localNetwork)?.linkAddresses?.isNotEmpty() == true) { "wifi_unavailable" }
    val socket = ServerSocket()
    try { socket.bind(InetSocketAddress(0), 8) } catch (error: Exception) { socket.close(); throw error }
    server = socket
    val token = generation
    val info = NsdServiceInfo().apply {
      serviceName = lobbyId; serviceType = this@TogetherLanModule.serviceType
      port = socket.localPort; setAttribute("lobby", lobbyId)
      if (Build.VERSION.SDK_INT >= 33 && localNetwork != null) setNetwork(localNetwork)
    }
    val callback = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(info: NsdServiceInfo) {
        // Registration may finish after stop attempted to unregister it.
        if (!post { if (generation != token) runCatching { nsd.unregisterService(this) } })
          runCatching { nsd.unregisterService(this) }
      }
      override fun onServiceUnregistered(info: NsdServiceInfo) {}
      override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) { post {
        if (generation == token) { emit("type" to "error", "code" to "advertising_failed"); stopAll() }
      } }
      override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
    }
    registration = callback
    try { nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, callback) }
    catch (error: Exception) { stopAll(); throw error }
    io.execute {
      try {
        while (!socket.isClosed) {
          val incoming = socket.accept()
          if (!peerSlots.tryAcquire()) { incoming.close(); continue }
          if (!post {
            if (generation != token || server !== socket) { incoming.close(); peerSlots.release() }
            else attach(incoming, true)
          }) { incoming.close(); peerSlots.release() }
        }
      } catch (_: Exception) { post {
        if (generation == token && server === socket) { emit("type" to "error", "code" to "listener_failed"); stopAll() }
      } }
    }
  }

  private fun discover() {
    if (discovery != null) return
    if (!hotspotOwner) wifi()
    val token = generation
    val callback = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) {
        if (!post { if (generation != token) runCatching { nsd.stopServiceDiscovery(this) } })
          runCatching { nsd.stopServiceDiscovery(this) }
      }
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, code: Int) { post {
        if (generation == token) { emit("type" to "error", "code" to "discovery_failed"); stopAll() }
      } }
      override fun onStopDiscoveryFailed(type: String, code: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) { post {
        if (generation == token && info.serviceType.trimEnd('.') == serviceType.trimEnd('.') &&
          !services.containsKey(info.serviceName) && resolving.none { it.serviceName == info.serviceName } &&
          endpoints.size + resolving.size < 64) {
          resolving.addLast(info); resolveNext(token)
        }
      } }
      override fun onServiceLost(info: NsdServiceInfo) { post {
        if (generation == token) {
          resolving.removeAll { it.serviceName == info.serviceName }
          services.remove(info.serviceName)?.let { id -> endpoints.remove(id); emit("type" to "lost", "endpointId" to id) }
        }
      } }
    }
    discovery = callback
    try { nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, callback) }
    catch (error: Exception) { stopAll(); throw error }
  }

  @Suppress("DEPRECATION")
  private fun resolveNext(token: Int) {
    if (resolveActive || resolving.isEmpty() || generation != token) return
    val found = resolving.first()
    resolveActive = true
    resolveTimer = control.schedule({
      if (generation == token && resolveActive) { emit("type" to "error", "code" to "discovery_timeout"); stopAll() }
    }, 10, TimeUnit.SECONDS)
    val callback = object : NsdManager.ResolveListener {
      override fun onResolveFailed(info: NsdServiceInfo, code: Int) { finish(null) }
      override fun onServiceResolved(info: NsdServiceInfo) { finish(info) }
      private fun finish(info: NsdServiceInfo?) { post {
        if (generation != token) return@post
        resolveTimer?.cancel(false)
        resolveActive = false
        val present = resolving.remove(found)
        val lobbyId = info?.attributes?.get("lobby")?.toString(Charsets.UTF_8)
        if (present && info != null && lobbyId != null && validLobby(lobbyId) && endpoints.size < 64 && onLink(info.host)) {
          val id = UUID.randomUUID().toString()
          services[info.serviceName] = id; endpoints[id] = info
          emit("type" to "discovered", "endpointId" to id, "lobbyId" to lobbyId)
        }
        resolveNext(token)
      } }
    }
    try { nsd.resolveService(found, callback) }
    catch (_: Exception) { resolveTimer?.cancel(false); resolveActive = false; resolving.remove(found); resolveNext(token) }
  }

  private fun onLink(address: InetAddress?): Boolean {
    if (address == null || address.isLoopbackAddress || address.isAnyLocalAddress || address.isMulticastAddress) return false
    if (hotspotOwner) return ownerAddress(address) != null
    val active = network ?: return false
    return connectivity.getLinkProperties(active)?.linkAddresses?.any { local ->
      val a = address.address; val b = local.address.address
      a.size == b.size && (0 until local.prefixLength).all { bit ->
        ((a[bit / 8].toInt() xor b[bit / 8].toInt()) and (1 shl (7 - bit % 8))) == 0
      }
    } == true
  }

  @Suppress("DEPRECATION")
  private fun connect(endpointId: String) {
    val info = endpoints[endpointId] ?: error("unknown_endpoint")
    check(peers.size < 8) { "peer_limit" }
    val localNetwork = if (hotspotOwner) null else wifi()
    check(onLink(info.host)) { "endpoint_not_local" }
    val socket = Socket()
    try { if (localNetwork != null) localNetwork.bindSocket(socket)
      else socket.bind(InetSocketAddress(requireNotNull(ownerAddress(info.host)), 0))
    } catch (error: Exception) { socket.close(); throw error }
    if (!peerSlots.tryAcquire()) { socket.close(); error("peer_limit") }
    val id = UUID.randomUUID().toString()
    val peer = Peer(socket); peers[id] = peer
    deadline(id, peer, 10)
    io.execute {
      try {
        socket.connect(InetSocketAddress(info.host, info.port), 10_000)
        post { if (peers[id] === peer) {
          if (hotspotOwner && !ownerRoute(socket.localAddress, socket.inetAddress)) drop(id, "endpoint_not_local")
          else ready(id, peer, false)
        } }
      } catch (_: Exception) { post { if (peers[id] === peer) drop(id, "connect_failed") } }
    }
  }

  private fun attach(socket: Socket, incoming: Boolean) {
    // The dual-stack listener can accept either advertised address family. Reject
    // every destination other than an address currently owned by our Wi-Fi network.
    val localWifi = if (hotspotOwner) ownerRoute(socket.localAddress, socket.inetAddress) else network?.let { connectivity.getLinkProperties(it) }?.linkAddresses?.any {
      it.address == socket.localAddress
    } == true
    if (!localWifi || !onLink(socket.inetAddress)) { socket.close(); peerSlots.release(); return }
    val id = UUID.randomUUID().toString()
    val peer = Peer(socket); peers[id] = peer
    ready(id, peer, incoming)
  }

  private fun ready(id: String, peer: Peer, incoming: Boolean) {
    peer.ready = true; peer.socket.tcpNoDelay = true
    emit("type" to "connected", "peerId" to id, "incoming" to incoming)
    deadline(id, peer, 30)
    io.execute {
      try {
        val input = DataInputStream(peer.socket.getInputStream())
        while (!peer.socket.isClosed) {
          val length = input.readInt()
          require(length in 1..65_536)
          val bytes = ByteArray(length); input.readFully(bytes)
          val frame = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
          // Wait for control to deliver each frame: the event queue is bounded by a single reader.
          control.submit {
            if (peers[id] === peer) {
              val now = System.nanoTime()
              if (now - peer.frameWindow > 1_000_000_000L) { peer.frameWindow = now; peer.frameCount = 0 }
              peer.frameCount++
              if (peer.frameCount > 60) drop(id, "frame_rate_limit")
              else { emit("type" to "frame", "peerId" to id, "frame" to frame); deadline(id, peer, 30) }
            }
          }.get()
        }
      } catch (_: Exception) { post { if (peers[id] === peer) drop(id, "read_failed") } }
    }
  }

  private fun deadline(id: String, peer: Peer, seconds: Long) {
    peer.timer?.cancel(false)
    peer.timer = control.schedule({ if (peers[id] === peer) drop(id, "read_timeout") }, seconds, TimeUnit.SECONDS)
  }

  private fun writeNext(id: String, peer: Peer) {
    val (bytes, promise) = peer.writes.first()
    peer.writeTimer = control.schedule({ if (peers[id] === peer) drop(id, "write_timeout") }, 10, TimeUnit.SECONDS)
    io.execute {
      try {
        val out = DataOutputStream(peer.socket.getOutputStream())
        out.writeInt(bytes.size); out.write(bytes); out.flush()
        post {
          if (peers[id] === peer) {
            peer.writeTimer?.cancel(false)
            peer.writes.removeFirst(); promise.resolve(null)
            if (peer.writes.isNotEmpty()) writeNext(id, peer)
          }
        }
      } catch (_: Exception) { post { if (peers[id] === peer) drop(id, "send_failed") } }
    }
  }

  private fun drop(id: String, code: String? = null) {
    val peer = peers.remove(id) ?: return
    peer.timer?.cancel(false)
    peer.writeTimer?.cancel(false)
    peerSlots.release()
    runCatching { peer.socket.close() }
    peer.writes.forEach { it.second.reject("disconnected", "Local connection closed", null) }
    peer.writes.clear()
    if (code != null) emit("type" to "error", "code" to code, "peerId" to id)
    emit("type" to "disconnected", "peerId" to id)
  }

  private fun stopAll() {
    generation++
    resolveTimer?.cancel(false)
    discovery?.let { runCatching { nsd.stopServiceDiscovery(it) } }; discovery = null
    registration?.let { runCatching { nsd.unregisterService(it) } }; registration = null
    runCatching { server?.close() }; server = null
    peers.keys.toList().forEach { drop(it) }
    endpoints.keys.forEach { emit("type" to "lost", "endpointId" to it) }
    endpoints.clear(); services.clear(); resolving.clear(); resolveActive = false; network = null; hotspotOwner = false
  }
}
