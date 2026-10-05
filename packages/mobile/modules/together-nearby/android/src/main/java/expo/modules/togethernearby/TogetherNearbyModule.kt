package expo.modules.togethernearby

import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID

/** Untrusted BYTES only. Together's signed discovery and encrypted channel authenticate above this. */
class TogetherNearbyModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val service = "uk.persistence.together.v1"
  private var connectionsClient: ConnectionsClient? = null
  private val client get() = connectionsClient ?: Nearby.getConnectionsClient(requireNotNull(appContext.reactContext).applicationContext).also { connectionsClient = it }
  private var generation = 0
  private var mode: String? = null
  private val endpoints = mutableMapOf<String, String>()
  private val peers = mutableMapOf<String, Peer>()
  private class Peer(val incoming: Boolean) {
    var ready = false
    var frames = 0
    var window = System.nanoTime()
    var writes = 0
    var deadline: Runnable? = null
  }
  override fun definition() = ModuleDefinition {
    Name("TogetherNearby")
    Constants("available" to true)
    Events("onEvent")
    AsyncFunction("startHost") { lobbyId: String, promise: Promise -> handler.post {
      start("host", promise) { token ->
        require(UUID.fromString(lobbyId).toString() == lobbyId) { "invalid_lobby" }
        client.startAdvertising(lobbyId.toByteArray(), service, lifecycle(token),
          AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
          .addOnSuccessListener { if (generation == token) promise.resolve(null) else promise.reject("cancelled", "Nearby stopped", null) }
          .addOnFailureListener { failure(token, promise, "advertising_failed") }
      }
    } }
    AsyncFunction("startDiscovery") { promise: Promise -> handler.post {
      start("guest", promise) { token ->
        client.startDiscovery(service, object : EndpointDiscoveryCallback() {
          override fun onEndpointFound(id: String, info: DiscoveredEndpointInfo) {
            if (generation != token || info.serviceId != service || endpoints.size >= 64) return
            val lobby = runCatching { strict(info.endpointInfo) }.getOrNull() ?: return
            if (runCatching { UUID.fromString(lobby).toString() == lobby }.getOrDefault(false)) {
              endpoints[id] = lobby
              emit("type" to "discovered", "endpointId" to id, "lobbyId" to lobby)
            }
          }
          override fun onEndpointLost(id: String) {
            if (generation == token && endpoints.remove(id) != null) emit("type" to "lost", "endpointId" to id)
          }
        }, DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
          .addOnSuccessListener { if (generation == token) promise.resolve(null) else promise.reject("cancelled", "Nearby stopped", null) }
          .addOnFailureListener { failure(token, promise, "discovery_failed") }
      }
    } }
    AsyncFunction("connect") { id: String, promise: Promise -> handler.post {
      try {
        check(mode == "guest" && endpoints.containsKey(id) && peers.isEmpty()) { "unknown_or_busy_endpoint" }
        val token = generation
        val peer = Peer(false); peers[id] = peer; deadline(id, peer, 10_000)
        // Empty context reveals no account identity to an unverified endpoint.
        client.requestConnection(byteArrayOf(), id, lifecycle(token))
          .addOnSuccessListener { if (generation == token && peers[id] === peer) promise.resolve(null) else promise.reject("cancelled", "Nearby stopped", null) }
          .addOnFailureListener { if (generation == token && peers[id] === peer) drop(id, "connect_failed"); promise.reject("connect_failed", "Nearby connection failed", null) }
      } catch (e: Exception) { promise.reject("connect_failed", e.message, e) }
    } }
    AsyncFunction("send") { id: String, frame: String, promise: Promise -> handler.post {
      val peer = peers[id]
      val bytes = frame.toByteArray(Charsets.UTF_8)
      if (peer == null || !peer.ready || bytes.isEmpty() || bytes.size > 32768 || peer.writes >= 16) {
        promise.reject("frame_limit", "Unknown peer or frame limit", null)
      } else {
        peer.writes++
        val token = generation
        var settled = false
        val timeout = Runnable { if (!settled) { settled = true; if (peers[id] === peer) drop(id, "write_timeout"); promise.reject("write_timeout", "Nearby write timed out", null) } }
        handler.postDelayed(timeout, 10_000)
        client.sendPayload(id, Payload.fromBytes(bytes)).addOnCompleteListener { task ->
          if (settled) return@addOnCompleteListener
          settled = true; handler.removeCallbacks(timeout); peer.writes--
          if (task.isSuccessful && generation == token && peers[id] === peer) promise.resolve(null)
          else { if (peers[id] === peer) drop(id, "send_failed"); promise.reject("send_failed", "Nearby write failed", null) }
        }
      }
    } }
    AsyncFunction("disconnect") { id: String, promise: Promise -> handler.post { drop(id); promise.resolve(null) } }
    AsyncFunction("stop") { promise: Promise -> handler.post { stop(); promise.resolve(null) } }
    OnDestroy { handler.post { stop() } }
  }
  private fun strict(bytes: ByteArray): String = Charsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
  private fun emit(vararg fields: Pair<String, Any>) { sendEvent("onEvent", mapOf(*fields)) }
  private fun permissions(targetSdk: Int): Array<String> = buildList {
    if (Build.VERSION.SDK_INT <= 32) add("android.permission.ACCESS_FINE_LOCATION")
    if (Build.VERSION.SDK_INT >= 31) addAll(listOf("android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_ADVERTISE"))
    if (Build.VERSION.SDK_INT >= 33) add("android.permission.NEARBY_WIFI_DEVICES")
    if (Build.VERSION.SDK_INT >= 37 && targetSdk >= 37) add("android.permission.ACCESS_LOCAL_NETWORK")
  }.toTypedArray()
  private fun start(next: String, promise: Promise, action: (Int) -> Unit) {
    if (mode != null) { promise.reject("already_started", "Stop Nearby before changing mode", null); return }
    val context = appContext.reactContext
    if (context == null) { promise.reject("permissions_unavailable", "Nearby context unavailable", null); return }
    val required = permissions(context.applicationInfo.targetSdkVersion)
    val token = ++generation
    mode = next
    val permissionManager = appContext.permissions
    if (permissionManager == null) { failure(token, promise, "permissions_unavailable"); return }
    permissionManager.askForPermissions({ _ -> handler.post {
      if (generation != token) { promise.reject("cancelled", "Nearby stopped", null); return@post }
      if (appContext.reactContext == null || !permissionManager.hasGrantedPermissions(*required)) { failure(token, promise, "permission_denied"); return@post }
      try { action(token) } catch (e: Exception) { failure(token, promise, "nearby_unavailable") }
    } }, *required)
  }
  private fun lifecycle(token: Int) = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(id: String, info: ConnectionInfo) {
      if (generation != token) return
      val incoming = info.isIncomingConnection
      if ((incoming && (mode != "host" || peers.size >= 8 || peers.containsKey(id))) || (!incoming && peers[id] == null)) {
        client.rejectConnection(id); return
      }
      val peer = peers[id] ?: Peer(true).also { peers[id] = it; deadline(id, it, 10_000) }
      // This accepts an untrusted transport ONLY. No credential/consent/admission is implied.
      client.acceptConnection(id, payload(token, peer)).addOnFailureListener {
        if (generation == token && peers[id] === peer) drop(id, "accept_failed")
      }
    }
    override fun onConnectionResult(id: String, result: ConnectionResolution) {
      if (generation != token) return
      val peer = peers[id] ?: return
      if (!result.status.isSuccess) { drop(id, "connect_failed"); return }
      peer.ready = true; deadline(id, peer, 30_000)
      emit("type" to "connected", "peerId" to id, "incoming" to peer.incoming)
    }
    override fun onDisconnected(id: String) { if (generation == token) drop(id) }
  }
  private fun payload(token: Int, expected: Peer) = object : PayloadCallback() {
    override fun onPayloadReceived(id: String, payload: Payload) {
      if (generation != token || peers[id] !== expected) return
      val bytes = payload.asBytes()
      if (payload.type != Payload.Type.BYTES || bytes == null || bytes.isEmpty() || bytes.size > 32768) {
        client.cancelPayload(payload.id); drop(id, "invalid_frame"); return
      }
      val now = System.nanoTime()
      if (now - expected.window >= 1_000_000_000) { expected.window = now; expected.frames = 0 }
      if (++expected.frames > 60) { drop(id, "frame_rate_limit"); return }
      val frame = runCatching { strict(bytes) }.getOrNull() ?: run { drop(id, "invalid_utf8"); return }
      deadline(id, expected, 30_000)
      emit("type" to "frame", "peerId" to id, "frame" to frame)
    }
    override fun onPayloadTransferUpdate(id: String, update: PayloadTransferUpdate) {
      if (generation == token && peers[id] === expected && (update.status == PayloadTransferUpdate.Status.FAILURE || update.status == PayloadTransferUpdate.Status.CANCELED)) drop(id, "transfer_failed")
    }
  }
  private fun deadline(id: String, peer: Peer, delay: Long) {
    peer.deadline?.let { handler.removeCallbacks(it) }
    peer.deadline = Runnable { if (peers[id] === peer) drop(id, "read_timeout") }.also { handler.postDelayed(it, delay) }
  }
  private fun drop(id: String, code: String? = null) {
    val peer = peers.remove(id) ?: return
    peer.deadline?.let { handler.removeCallbacks(it) }
    connectionsClient?.disconnectFromEndpoint(id)
    if (code != null) emit("type" to "error", "peerId" to id, "code" to code)
    emit("type" to "disconnected", "peerId" to id)
  }
  private fun stop() {
    ++generation; mode = null
    peers.keys.toList().forEach { drop(it) }; endpoints.clear()
    connectionsClient?.let { it.stopAdvertising(); it.stopDiscovery(); it.stopAllEndpoints() }
  }
  private fun failure(token: Int, promise: Promise, code: String) {
    if (generation == token) stop()
    promise.reject(code, "Nearby unavailable", null)
  }
}
