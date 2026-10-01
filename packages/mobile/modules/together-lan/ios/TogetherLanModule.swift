import ExpoModulesCore
import Foundation
import Network

public final class TogetherLanModule: Module {
  private let queue = DispatchQueue(label: "persistence.together.lan")
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var endpoints: [String: NWEndpoint] = [:]
  private var peers: [String: Peer] = [:]
  private let serviceType = "_persist-tg._tcp"

  private final class Peer {
    let connection: NWConnection
    var timer: DispatchWorkItem?
    var writes = 0
    var ready = false
    var frameWindow = DispatchTime.now().uptimeNanoseconds
    var frameCount = 0
    init(_ connection: NWConnection) { self.connection = connection }
  }

  public func definition() -> ModuleDefinition {
    Name("TogetherLan")
    Events("onEvent")
    AsyncFunction("startHost") { (lobbyId: String) in
      try self.queue.sync { try self.host(lobbyId) }
    }
    AsyncFunction("startDiscovery") { self.queue.sync { self.discover() } }
    AsyncFunction("connect") { (endpointId: String) in
      try self.queue.sync {
        guard let endpoint = self.endpoints[endpointId] else { throw self.failure("unknown_endpoint") }
        guard self.peers.count < 8 else { throw self.failure("peer_limit") }
        self.attach(NWConnection(to: endpoint, using: self.parameters()), incoming: false)
      }
    }
    AsyncFunction("send") { (peerId: String, frame: String, promise: Promise) in
      self.queue.async {
        guard let peer = self.peers[peerId], peer.ready else {
          promise.reject("not_connected", "Peer is not connected"); return
        }
        let payload = Data(frame.utf8)
        guard !payload.isEmpty, payload.count <= 65_536, peer.writes < 16 else {
          promise.reject("frame_limit", "Frame or pending-write limit exceeded"); return
        }
        var length = UInt32(payload.count).bigEndian
        var wire = withUnsafeBytes(of: &length) { Data($0) }
        wire.append(payload)
        peer.writes += 1
        let timeout = DispatchWorkItem { [weak self] in self?.drop(peerId, code: "write_timeout") }
        self.queue.asyncAfter(deadline: .now() + 10, execute: timeout)
        // NWConnection preserves send ordering; at most 16 sends are in flight.
        peer.connection.send(content: wire, completion: .contentProcessed { error in
          timeout.cancel()
          peer.writes -= 1
          if error != nil {
            promise.reject("send_failed", "Local connection closed")
            self.drop(peerId, code: "send_failed")
          } else { promise.resolve() }
        })
      }
    }
    AsyncFunction("disconnect") { (peerId: String) in self.queue.sync { self.drop(peerId) } }
    AsyncFunction("stop") { self.queue.sync { self.stopAll() } }
    OnDestroy { self.queue.sync { self.stopAll() } }
  }

  private func failure(_ code: String) -> NSError {
    NSError(domain: "TogetherLan", code: 1, userInfo: [NSLocalizedDescriptionKey: code])
  }

  private func parameters() -> NWParameters {
    let parameters = NWParameters.tcp
    parameters.includePeerToPeer = false
    parameters.requiredInterfaceType = .wifi
    return parameters
  }

  private func emit(_ event: [String: Any]) { sendEvent("onEvent", event) }

  private func host(_ lobbyId: String) throws {
    guard UUID(uuidString: lobbyId)?.uuidString.lowercased() == lobbyId else { throw failure("invalid_lobby") }
    guard listener == nil else { throw failure("already_hosting") }
    let next = try NWListener(using: parameters())
    listener = next
    let txt = Array("lobby=\(lobbyId)".utf8)
    next.service = NWListener.Service(name: lobbyId, type: serviceType, txtRecord: Data([UInt8(txt.count)] + txt))
    next.newConnectionHandler = { [weak self, weak next] connection in
      guard let self, let next, self.listener === next else { connection.cancel(); return }
      self.attach(connection, incoming: true)
    }
    next.stateUpdateHandler = { [weak self, weak next] state in
      guard let self, let next, self.listener === next else { return }
      if case .failed = state {
        self.emit(["type": "error", "code": "advertising_failed"])
        self.stopAll()
      }
    }
    next.start(queue: queue)
  }

  private func discover() {
    guard browser == nil else { return }
    let next = NWBrowser(for: .bonjourWithTXTRecord(type: serviceType, domain: "local."), using: parameters())
    browser = next
    next.browseResultsChangedHandler = { [weak self, weak next] results, _ in
      guard let self, let next, self.browser === next else { return }
      var observed: [String: NWEndpoint] = [:]
      for result in results {
        guard observed.count < 64 else { break }
        if case let .bonjour(txt) = result.metadata,
           case let .string(name) = txt.getEntry(for: "lobby"),
           UUID(uuidString: name)?.uuidString.lowercased() == name {
          // Endpoint IDs are opaque and valid only for the current discovery.
          let id = self.endpoints.first(where: { $0.value == result.endpoint })?.key ?? UUID().uuidString
          observed[id] = result.endpoint
          if self.endpoints[id] == nil { self.emit(["type": "discovered", "endpointId": id, "lobbyId": name]) }
        }
      }
      for id in self.endpoints.keys where observed[id] == nil { self.emit(["type": "lost", "endpointId": id]) }
      self.endpoints = observed
    }
    next.stateUpdateHandler = { [weak self, weak next] state in
      guard let self, let next, self.browser === next else { return }
      if case .failed = state {
        self.emit(["type": "error", "code": "discovery_failed"])
        self.stopAll()
      }
    }
    next.start(queue: queue)
  }

  private func attach(_ connection: NWConnection, incoming: Bool) {
    guard peers.count < 8 else { connection.cancel(); return }
    let id = UUID().uuidString
    let peer = Peer(connection)
    peers[id] = peer
    deadline(id, seconds: 10)
    connection.stateUpdateHandler = { [weak self, weak peer] state in
      guard let self, let peer, self.peers[id] === peer else { return }
      switch state {
      case .ready:
        guard !peer.ready else { return }
        peer.ready = true
        self.emit(["type": "connected", "peerId": id, "incoming": incoming])
        self.readHeader(id, peer)
      case .failed, .cancelled: self.drop(id)
      default: break
      }
    }
    connection.start(queue: queue)
  }

  private func deadline(_ id: String, seconds: Double) {
    guard let peer = peers[id] else { return }
    peer.timer?.cancel()
    let timer = DispatchWorkItem { [weak self] in self?.drop(id, code: "read_timeout") }
    peer.timer = timer
    queue.asyncAfter(deadline: .now() + seconds, execute: timer)
  }

  private func readHeader(_ id: String, _ peer: Peer) {
    deadline(id, seconds: 30)
    receive(id, peer, count: 4) { data in
      let size = data.reduce(0) { ($0 << 8) | Int($1) }
      guard size > 0, size <= 65_536 else { self.drop(id, code: "invalid_frame"); return }
      // A single deadline spans header/body: trickled bytes do not extend it.
      self.receive(id, peer, count: size) { payload in
        guard let frame = String(data: payload, encoding: .utf8) else { self.drop(id, code: "invalid_utf8"); return }
        let now = DispatchTime.now().uptimeNanoseconds
        if now - peer.frameWindow > 1_000_000_000 { peer.frameWindow = now; peer.frameCount = 0 }
        peer.frameCount += 1
        guard peer.frameCount <= 60 else { self.drop(id, code: "frame_rate_limit"); return }
        self.emit(["type": "frame", "peerId": id, "frame": frame])
        self.readHeader(id, peer)
      }
    }
  }

  private func receive(_ id: String, _ peer: Peer, count: Int, buffered: Data = Data(), done: @escaping (Data) -> Void) {
    peer.connection.receive(minimumIncompleteLength: 1, maximumLength: count - buffered.count) { [weak self] data, _, complete, error in
      guard let self, self.peers[id] === peer else { return }
      var accumulated = buffered
      if let data { accumulated.append(data) }
      if accumulated.count == count { done(accumulated) }
      else if complete || error != nil { self.drop(id) }
      else { self.receive(id, peer, count: count, buffered: accumulated, done: done) }
    }
  }

  private func drop(_ id: String, code: String? = nil) {
    guard let peer = peers.removeValue(forKey: id) else { return }
    peer.timer?.cancel()
    peer.connection.cancel()
    if let code { emit(["type": "error", "code": code, "peerId": id]) }
    emit(["type": "disconnected", "peerId": id])
  }

  private func stopAll() {
    let oldBrowser = browser; browser = nil; oldBrowser?.cancel()
    let oldListener = listener; listener = nil; oldListener?.cancel()
    for id in Array(endpoints.keys) { emit(["type": "lost", "endpointId": id]) }
    endpoints.removeAll()
    for id in Array(peers.keys) { drop(id) }
  }
}
