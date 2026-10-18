import ExpoModulesCore
import Foundation
import NearbyConnections

// Why this symbol lives here (TestFlight crash 7D536D3B, 14 October 2026).
//
// Nearby Connections vendors BoringSSL, whose crypto/mem.c defines `sdallocx`
// (jemalloc's sized free) as a WEAK fallback to free(). React Native's prebuilt
// ReactNativeDependencies.framework exports `_sdallocx` from __DATA,__common
// (folly's jemalloc shim). At launch dyld coalesces weak definitions across
// images and rebinds BoringSSL's call to that data address; the first
// OPENSSL_free, inside the UKEY2 handshake when a guest requests a connection,
// jumps into non-executable memory and the kernel kills the process
// (EXC_BAD_ACCESS SIGKILL, "CODESIGNING 2 Invalid Page", OPENSSL_realloc
// mem.c:153 -> ... -> UKey2Handshake::ForInitiator). Same fault as
// google/nearby#2195 and apple/swift-nio-ssl#191.
//
// A STRONG definition wins over BoringSSL's weak one at static link time, so no
// weak binding is left for dyld to rewrite. It must sit in THIS object: the
// module class is always linked (ExpoModulesProvider references it), whereas a
// separate C file in the static archive is never pulled because BoringSSL's own
// object already satisfies the symbol. Verified with
// `nm -m PersistenceStaging | grep _sdallocx` → `(__TEXT,__text) external`,
// not `weak external`. Never mark this weak or move it out of this file.
@_cdecl("sdallocx")
public func togetherNearbySizedFree(_ ptr: UnsafeMutableRawPointer?, _ size: Int, _ flags: Int32) {
  free(ptr)
}

public final class TogetherNearbyModule: Module {
  private var engine: NearbyEngine?
  public func definition() -> ModuleDefinition {
    Name("TogetherNearby")
    Constants(["available": true])
    Events("onEvent")
    AsyncFunction("startHost") { (lobby: String, promise: Promise) in
      DispatchQueue.main.async { self.start(lobby: lobby, promise: promise) }
    }
    AsyncFunction("startDiscovery") { (promise: Promise) in
      DispatchQueue.main.async { self.start(lobby: nil, promise: promise) }
    }
    AsyncFunction("connect") { (id: String, promise: Promise) in
      DispatchQueue.main.async {
        guard let engine = self.engine else { promise.reject("not_started", "Nearby is stopped"); return }
        engine.connect(id, promise)
      }
    }
    AsyncFunction("send") { (id: String, frame: String, promise: Promise) in
      DispatchQueue.main.async {
        guard let engine = self.engine else { promise.reject("not_started", "Nearby is stopped"); return }
        engine.send(id, frame, promise)
      }
    }
    AsyncFunction("disconnect") { (id: String, promise: Promise) in
      DispatchQueue.main.async { self.engine?.drop(id); promise.resolve() }
    }
    AsyncFunction("stop") { (promise: Promise) in
      DispatchQueue.main.async { self.engine?.stop(); self.engine = nil; promise.resolve() }
    }
    OnDestroy { DispatchQueue.main.async { self.engine?.stop(); self.engine = nil } }
  }
  private func start(lobby: String?, promise: Promise) {
    guard engine == nil else { promise.reject("already_started", "Stop Nearby before changing mode"); return }
    if let lobby, UUID(uuidString: lobby)?.uuidString.lowercased() != lobby {
      promise.reject("invalid_lobby", "Invalid lobby"); return
    }
    let next = NearbyEngine { [weak self] event in self?.sendEvent("onEvent", event) }
    engine = next
    next.start(lobby, promise)
  }
}

/** All delegates and state run on main; an engine is never reused after stop. */
private final class NearbyEngine: ConnectionManagerDelegate, AdvertiserDelegate, DiscovererDelegate {
  private let manager = ConnectionManager(serviceID: "uk.persistence.together.v1", strategy: .star)
  private var advertiser: Advertiser!
  private var discoverer: Discoverer!
  // Explicit local media; WebRTC is excluded. LAN transport remains separately selectable.
  private let mediums: Set<Medium> = [.ble, .bluetooth, .wifiLAN]
  private let emit: ([String: Any]) -> Void
  /// SDK detail for the Together log (`type: "log"`); never a transport event.
  private func log(_ message: String, _ data: [String: Any] = [:]) {
    emit(["type": "log", "message": message, "data": data])
  }
  private func detail(_ error: Error?) -> [String: Any] {
    guard let error else { return [:] }
    let ns = error as NSError
    return ["error": error.localizedDescription, "domain": ns.domain, "errorCode": ns.code]
  }
  private var active = true
  private var host = false
  private var endpoints: [String: String] = [:]
  private var peers: [String: Peer] = [:]
  private final class Peer {
    let incoming: Bool
    var ready = false
    var writes = 0
    var frames = 0
    var window = Date()
    var timeout: DispatchWorkItem?
    init(_ incoming: Bool) { self.incoming = incoming }
  }
  init(emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
    manager.delegate = self
    advertiser = Advertiser(connectionManager: manager); advertiser.delegate = self
    discoverer = Discoverer(connectionManager: manager); discoverer.delegate = self
  }
  func start(_ lobby: String?, _ promise: Promise) {
    host = lobby != nil
    log(host ? "startAdvertising" : "startDiscovery", ["lobbyId": lobby ?? "", "mediums": "ble,bluetooth,wifiLAN"])
    let completed: (Error?) -> Void = { [weak self] error in
      DispatchQueue.main.async {
        guard let self, self.active else { promise.reject("cancelled", "Nearby stopped"); return }
        if let error {
          self.log(self.host ? "startAdvertising failed" : "startDiscovery failed", self.detail(error))
          self.stop()
          promise.reject("nearby_unavailable", "Nearby could not start (check Bluetooth and local-network permissions): \(error.localizedDescription)")
        } else {
          self.log(self.host ? "advertising" : "discovering")
          promise.resolve()
        }
      }
    }
    if let lobby { advertiser.startAdvertising(using: Data(lobby.utf8), mediums: mediums, completionHandler: completed) }
    else { discoverer.startDiscovery(mediums: mediums, completionHandler: completed) }
  }
  func connect(_ id: String, _ promise: Promise) {
    guard active, !host, endpoints[id] != nil, peers.isEmpty else {
      log("requestConnection refused", ["endpointId": id, "active": active, "host": host, "known": endpoints[id] != nil, "peers": peers.count])
      promise.reject("unknown_endpoint", "Unknown or busy endpoint"); return
    }
    log("requestConnection", ["endpointId": id, "lobbyId": endpoints[id] ?? ""])
    let peer = Peer(false); peers[id] = peer; deadline(id, peer, 10)
    discoverer.requestConnection(to: id, using: Data(), mediums: mediums) { [weak self, weak peer] error in
      DispatchQueue.main.async {
        guard let self, let peer, self.active, self.peers[id] === peer else { promise.reject("cancelled", "Nearby stopped"); return }
        if let error {
          var failure = self.detail(error); failure["endpointId"] = id
          self.log("requestConnection failed", failure)
          self.drop(id, "connect_failed")
          promise.reject("connect_failed", "Nearby connection failed: \(error.localizedDescription)")
        } else {
          self.log("requestConnection accepted", ["endpointId": id])
          promise.resolve()
        }
      }
    }
  }
  func send(_ id: String, _ frame: String, _ promise: Promise) {
    let bytes = Data(frame.utf8)
    guard active, let peer = peers[id], peer.ready, !bytes.isEmpty, bytes.count <= 32768, peer.writes < 16 else {
      promise.reject("frame_limit", "Unknown peer or frame limit"); return
    }
    peer.writes += 1
    var settled = false
    let timer = DispatchWorkItem { [weak self, weak peer] in
      guard !settled else { return }; settled = true
      // A late write deadline belongs to the original connection, never its replacement.
      if let self, let peer, self.peers[id] === peer {
        self.drop(id, "write_timeout")
      }
      promise.reject("write_timeout", "Nearby write timed out")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timer)
    _ = manager.send(bytes, to: [id]) { [weak self, weak peer] error in
      DispatchQueue.main.async {
        guard !settled else { return }; settled = true; timer.cancel()
        peer?.writes -= 1
        guard let self, let peer, self.active, self.peers[id] === peer, error == nil else {
          promise.reject("send_failed", "Nearby write failed"); return
        }
        promise.resolve()
      }
    }
  }
  private func deadline(_ id: String, _ peer: Peer, _ seconds: Double) {
    peer.timeout?.cancel()
    let timer = DispatchWorkItem { [weak self, weak peer] in
      guard let self, let peer, self.peers[id] === peer else { return }
      self.drop(id, "read_timeout")
    }
    peer.timeout = timer; DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: timer)
  }
  func drop(_ id: String, _ code: String? = nil) {
    guard let peer = peers.removeValue(forKey: id) else { return }
    log("drop", ["peerId": id, "code": code ?? "", "ready": peer.ready, "incoming": peer.incoming])
    peer.timeout?.cancel(); manager.disconnect(from: id)
    if let code { emit(["type": "error", "peerId": id, "code": code]) }
    emit(["type": "disconnected", "peerId": id])
  }
  func stop() {
    guard active else { return }; active = false
    advertiser.stopAdvertising(); discoverer.stopDiscovery()
    for id in Array(peers.keys) { drop(id) }; endpoints.removeAll()
    advertiser.delegate = nil; discoverer.delegate = nil; manager.delegate = nil
  }
  func advertiser(_ advertiser: Advertiser, didReceiveConnectionRequestFrom id: EndpointID, with context: Data, connectionRequestHandler: @escaping (Bool) -> Void) {
    guard active, host, peers.count < 8, peers[id] == nil else {
      log("connection request refused", ["peerId": id, "active": active, "host": host, "peers": peers.count])
      connectionRequestHandler(false); return
    }
    log("connection request accepted", ["peerId": id])
    let peer = Peer(true); peers[id] = peer; deadline(id, peer, 10)
    connectionRequestHandler(true)
  }
  func discoverer(_ discoverer: Discoverer, didFind id: EndpointID, with context: Data) {
    let lobby = String(data: context, encoding: .utf8)
    let valid = lobby.map { UUID(uuidString: $0)?.uuidString.lowercased() == $0 } ?? false
    log("didFind", ["endpointId": id, "lobbyId": lobby ?? "", "valid": valid, "active": active, "host": host, "known": endpoints.count])
    guard active, !host, endpoints.count < 64, let lobby, valid else { return }
    endpoints[id] = lobby; emit(["type": "discovered", "endpointId": id, "lobbyId": lobby])
  }
  func discoverer(_ discoverer: Discoverer, didLose id: EndpointID) {
    log("didLose", ["endpointId": id])
    if active, endpoints.removeValue(forKey: id) != nil { emit(["type": "lost", "endpointId": id]) }
  }
  func connectionManager(_ manager: ConnectionManager, didReceive verificationCode: String, from id: EndpointID, verificationHandler: @escaping (Bool) -> Void) {
    // Transport only: signed host selection + channel above us establish identity.
    let accept = active && peers[id] != nil
    log("verification", ["peerId": id, "accept": accept])
    verificationHandler(accept)
  }
  func connectionManager(_ manager: ConnectionManager, didChangeTo state: ConnectionState, for id: EndpointID) {
    let name: String
    switch state {
    case .connecting: name = "connecting"
    case .connected: name = "connected"
    case .disconnected: name = "disconnected"
    case .rejected: name = "rejected"
    }
    log("state \(name)", ["peerId": id, "known": peers[id] != nil, "active": active])
    guard active, let peer = peers[id] else { return }
    switch state {
    case .connecting: break
    case .connected:
      guard !peer.ready else { return }; peer.ready = true; deadline(id, peer, 30)
      emit(["type": "connected", "peerId": id, "incoming": peer.incoming])
    case .rejected: drop(id, "connection_rejected")
    // A link that closes before it was ever ready is a failed connection, not a lost one.
    case .disconnected: drop(id, peer.ready ? nil : "connection_closed")
    }
  }
  func connectionManager(_ manager: ConnectionManager, didReceive data: Data, withID payloadID: PayloadID, from id: EndpointID) {
    guard active, let peer = peers[id], peer.ready else { return }
    guard !data.isEmpty, data.count <= 32768, let frame = String(data: data, encoding: .utf8) else { drop(id, "invalid_frame"); return }
    if Date().timeIntervalSince(peer.window) >= 1 { peer.window = Date(); peer.frames = 0 }
    peer.frames += 1
    guard peer.frames <= 60 else { drop(id, "frame_rate_limit"); return }
    deadline(id, peer, 30); emit(["type": "frame", "peerId": id, "frame": frame])
  }
  func connectionManager(_ manager: ConnectionManager, didReceive stream: InputStream, withID payloadID: PayloadID, from id: EndpointID, cancellationToken token: CancellationToken) {
    token.cancel(); drop(id, "invalid_payload")
  }
  func connectionManager(_ manager: ConnectionManager, didStartReceivingResourceWithID payloadID: PayloadID, from id: EndpointID, at localURL: URL, withName name: String, cancellationToken token: CancellationToken) {
    token.cancel(); drop(id, "invalid_payload")
  }
  func connectionManager(_ manager: ConnectionManager, didReceiveTransferUpdate update: TransferUpdate, from id: EndpointID, forPayload payloadID: PayloadID) {
    guard active else { return }
    switch update {
    case .failure, .canceled:
      log("transfer failed", ["peerId": id])
      drop(id, "transfer_failed")
    default: break
    }
  }
}
