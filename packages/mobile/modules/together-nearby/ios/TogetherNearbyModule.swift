import ExpoModulesCore
import Foundation
import NearbyConnections

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
    let completed: (Error?) -> Void = { [weak self] error in
      DispatchQueue.main.async {
        guard let self, self.active else { promise.reject("cancelled", "Nearby stopped"); return }
        if error != nil { self.stop(); promise.reject("nearby_unavailable", "Check Bluetooth and local-network permissions") }
        else { promise.resolve() }
      }
    }
    if let lobby { advertiser.startAdvertising(using: Data(lobby.utf8), mediums: mediums, completionHandler: completed) }
    else { discoverer.startDiscovery(mediums: mediums, completionHandler: completed) }
  }
  func connect(_ id: String, _ promise: Promise) {
    guard active, !host, endpoints[id] != nil, peers.isEmpty else { promise.reject("unknown_endpoint", "Unknown or busy endpoint"); return }
    let peer = Peer(false); peers[id] = peer; deadline(id, peer, 10)
    discoverer.requestConnection(to: id, using: Data(), mediums: mediums) { [weak self, weak peer] error in
      DispatchQueue.main.async {
        guard let self, let peer, self.active, self.peers[id] === peer else { promise.reject("cancelled", "Nearby stopped"); return }
        if error != nil { self.drop(id, "connect_failed"); promise.reject("connect_failed", "Nearby connection failed") }
        else { promise.resolve() }
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
    guard active, host, peers.count < 8, peers[id] == nil else { connectionRequestHandler(false); return }
    let peer = Peer(true); peers[id] = peer; deadline(id, peer, 10)
    connectionRequestHandler(true)
  }
  func discoverer(_ discoverer: Discoverer, didFind id: EndpointID, with context: Data) {
    guard active, !host, endpoints.count < 64, let lobby = String(data: context, encoding: .utf8), UUID(uuidString: lobby)?.uuidString.lowercased() == lobby else { return }
    endpoints[id] = lobby; emit(["type": "discovered", "endpointId": id, "lobbyId": lobby])
  }
  func discoverer(_ discoverer: Discoverer, didLose id: EndpointID) {
    if active, endpoints.removeValue(forKey: id) != nil { emit(["type": "lost", "endpointId": id]) }
  }
  func connectionManager(_ manager: ConnectionManager, didReceive verificationCode: String, from id: EndpointID, verificationHandler: @escaping (Bool) -> Void) {
    // Transport only: signed host selection + channel above us establish identity.
    verificationHandler(active && peers[id] != nil)
  }
  func connectionManager(_ manager: ConnectionManager, didChangeTo state: ConnectionState, for id: EndpointID) {
    guard active, let peer = peers[id] else { return }
    switch state {
    case .connecting: break
    case .connected:
      guard !peer.ready else { return }; peer.ready = true; deadline(id, peer, 30)
      emit(["type": "connected", "peerId": id, "incoming": peer.incoming])
    case .disconnected, .rejected: drop(id)
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
    switch update { case .failure, .canceled: drop(id, "transfer_failed"); default: break }
  }
}
