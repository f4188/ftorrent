
//need to replace
dgram = require('dgram')
crypto = require('crypto')

Peer = require('../lib/peerinfo.js').PeerInfo
NSET = require('../lib/NSet.js').NSet

benDecode = require('bencode').decode
benEncode = require('bencode').encode

const NODE_STATE = { GOOD: 0, QUES : 1, BAD : 2}

var flatten = (list) => list.reduce((a,b) => a.concat(b)) 

class DHT {

	constructor(port, host, sock) {

		//buckets = [ [first level], [second level], ... ]
		// {  1st lvl  (s) , _________________________________}  0 to 2^160
		//                  {   2nd lvl  (s), ________________}  0 to 2^159, 2^159 to 2^160
		//                                  {____, (s) 3rd lvl}  0 to 2^159  2^159 to 2^159+2^158
		//                                   mynode

		this.nodes = new Map()
		this.buckets = [new Bucket(0, 2**160)]
		this.myNodeID = null

		this.infoHashes = {} //{infoHash1 : [peerlist... ], infoHash2 : [peerlist...]}
		
		this.default_timeout = 5000
		this.port = port
		this.host = host

		if(sock)
			this.sock = sock
		else {
			this.sock = dgram.createSocket('udp4')
			this.sock.bind(port)
		}

		this.sock.on('message', this._recvRequest)	

		this.newToken = {} //new token every five minutes
		this.oldToken = {} //replaced with newToken

		let self = this

		var _tokenUpdater = function tknUpdtr() {

			self.oldToken = self.newToken
			//self.newToken.value = crypto.randomBytes(8)
			let hash = crypto.createHash('sha1')
			self.newToken.value = hash.update(self.host.split('.').join("")).digest('hex') + crypto.randomBytes(4)
			self.newToken.hosts = new Set()

		}

		_tokenUpdater()

		this.tokenInterval = setInterval(_tokenUpdater, 5*60*1e3)

		var _makeNode = () => {

			return (nodeID, port, host) => {
				
				let node = this.nodes.get(nodeID)
				if(!node) {
					node = new Node(nodeID, port, host, this.myNodeID, this.sock)
					this.nodes.put(node)
				} else {
					node.update(port, host)
				}
			
				if(this._inDHT()) this.insertNodeInDHT(nodeID)

				return node 
			}
		}

		this.makeNode = _makeNode()

		this.loadDHT()

	}

	getToken(host) {

		this.newToken.hosts.add(host)		
		return this.newToken.value

	}

	isTokenValid(token, host) {

		if(this.newToken.hosts.has(host) && this.newToken.value == token
			|| this.oldToken.hosts.has(host) && this.newToken.value == token) //
			return true
		else 
			return false

	}

	//load dht from storage
	loadDHT() {
		//this.myNodeID = crypto.randomBytes(20)
	}

	lookup(url) {

		return new Promise(resolve, reject) {
			dns.lookup(url, (error, address, family) => {
				if(error) 
					reject(error)
				else 
					resolve(address)
			})
		}

	}

	async bootstrap() {
		
		this.myNodeID = crypto.randomBytes(20)
		this.makeNode(this.myNodeID ,this.port, this.host)

		let bootstrapNodeAddrs = [[6881, 'dht.transmissionbt.com'], [6881, 'router.utorrent.com'], [6881, 'router.bittorrent.com']]
		
		let ips = await Promise.all(bootstrapNodesAddrs.map( async node => 
			try {
				return await lookup(node[1])
			} catch(err) {

			} 
		))

		ips = ips.filter(x => x)

		let bootStrapNode = new Node("", 6881, ips[0], this.myNodeID, this.sock) //do not insert in routing table

		let nodes = await bootStrapNode.findNode(this.myNodeID) // inserts nodes in dht 

		this.findNodeIter(this.myNodeID) //builds dht

	}

	saveDHT() {

	}

	//returns [peers] and inserts this peer into mainline DHT
	async announce(infoHash) {

		let [peers, nodes] = await getPeersIter(infoHash)

		//let aNodes = await Promise.all(nodes.forEach(node => node.announcePeer(infoHash, this.port)))
		nodes.forEach(node => node.announcePeer(infoHash, this.port))
		
		return peers

	}

	xorCompare(id) {

		return (nodeID1, nodeID2) => (nodeID1 ^ id) > (nodeID2 ^ id)

	}

	async findNodeIter(nodeID)  {

		let [node, nodes] = this.findNode(infoHash)
		if(nodeID == this.myNodeID) 
			node = undefined
		
		let allNodes = new NSet(nodes), queriedNodes = new NSet(), nodesToQuery = allNodes, lastIter = false

		while ( nodesToQuery.size > 0 || !node) {
	
			let results = await Promise.all( Array.from( nodesToQuery ).map( async (node) => await node.findNode(infoHash) ))	
			queriedNodes = queriedNodes.union(nodesToQuery)
			allNodes = allNodes.union( new NSet(flatten(results.filter(x => x).map(x => x[1]))) )
			nodesToQuery = new NSet(Array.from(allNodes).sort(xorCompare(infoHash)).slice(0,8)).difference(queriedNodes)

			node = flatten(results.map(x => x[0])).find( node => node.nodeID == nodeID ) 

		}

		return [node, Array.from(allNodes).sort(xorCompare(infoHash)).slice(0,8)]
	}

	async getPeersIter(infoHash) {

		let [peers, nodes] = this.getPeers(infoHash) 
		
		let allNodes = new NSet(nodes), queriedNodes = new NSet(), nodesToQuery = allNodes, lastIter = false

		while( nodesToQuery.size > 0 ) {
	
			let results = await Promise.all( Array.from( nodesToQuery ).map( async (node) => await node.getPeers(infoHash) ) )
			
			queriedNodes = queriedNodes.union(nodesToQuery)
			allNodes = allNodes.union( new NSet(flatten(results.filter(x => x).map(x => x[1]))) )
			peers.concat(flatten(results.map(x => x[0]))) 
			nodesToQuery = new NSet(Array.from(allNodes).sort(xorCompare(infoHash)).slice(0,8)).difference(queriedNodes)

			/*if(lastIter) {
				if ( nodesToQuery.size == 0 )
					break
				else 
					lastIter = false
			}

			if(nodesToQuery.size == 0) {
				nodesToQuery = Array.from(allNodes.difference(queriedNodes)).sort(xorCompare(infoHash)).slice(0,8)
				lastIter = true
			}*/

		}

		return [peers.filter(x => x), Array.from(allNodes).sort(xorCompare(infoHash)).slice(0,8)]

	}

	//called by respGetPeers and announce
	getPeers(infoHash) {

		let [node, nodes, hasMyNode] = this._getClosestNodes(infoHash)
		let peers = []
		if(hasMyNode)
			peers = this.infoHashes[infoHash]
		return [peers, nodes]

	}
 	
 	//called by respFindNode
	findNode(nodeID) { 

		let [node, nodes, hasMyNode] = this._getClosestNodes(nodeID)
		return [[node], nodes]

	}

	_getClosestNodes(id) { 

		let nodeIDs = flatten(this.buckets.map(bucket => bucket.getBucketNodeIDs())) //.reduce((a,b) => a.concat(b))
		
		nodeIDs.sort(xorCompare(id))
		let kClosestNodeIDs = nodeIDs.slice(10)

		let node, myNode, hasMyNodeID

		let pos = kClosestNodes.findIndex((nodeID) => nodeID == id)

		if(pos != -1)
			node = getNode(kClosestNodes.splice(pos, 1))

		pos = kClosestNodes.findIndex(this.myNodeID)

		if(pos != -1) {
			kClosestNodes.splice(pos, 1)
			hasMyNodeID = true
		}

		return [node, nodeIDs.slice(8).map(nodeID => getNode(nodeID)), hasMyNodeID]

	}

	getNode(nodeID) {

		return this.nodes.get(nodeID)

	}

	async insertNodeInDHT(nodeID) {

		node = this.getNode(nodeID)

		let bucket = this._findBucketFits(nodeID)

		if(!bucket.isFull()) {

			bucket.insert(nodeID)
			//node.inDHT = true

		else if (bucket == this.buckets.slice(-1)) { //bucket with myNode

			bucket.insert(nodeID)

			while(this.buckets.slice(-1).isFull()) {

				let bucket = this.buckets.pop()
				let b1, b2 = bucket.split()

				if(b1.contains(this.myNodeID)) {
					this.buckets.push(b2)
					this.buckets.push(b1)
				}
				else {
					this.buckets.push(b1)
					this.buckets.push(b2)
				}
			}

		} else { //doesn't already contain node and is full
			//ping questionable nodes
			quesNodeIDs = bucket.getNodes().filter( (id) => getNode(id).state != NODE_STATE.GOOD)
			quesNodeIDs.sort( (id) => Math.max(getNode(id).lastReqTime, getNode(id).lastRespTime))

			aQuesNodeID = quesNodeIDs.shift()

			while( queryNodeIDs.length != 0 ) {

				try{

					await getNode(aQuesNodeID).ping()
					
				} catch (error) {

					bucket.remove(aQuesNodeID)
					//getNode(aQuesNodeID).inDHT = false

					bucket.insert(node)
					//node.inDHT = true
					return 

				}

				aQuesNodeID = quesNodeIDs.shift()	

			}

		}
		
	}

	_inDHT(id) {

		return _findBucketFits(id).has(id)

	}

	//infoHash or nodeID
	_findBucketFits(id) {

		return this.buckets.find((bucket) => bucket.fits(id)) //always returns a bucket

	}

	_recvRequest(msg, rinfo) {

		let request = benDecode(msg) // return 203 if malformed

		queryNodeID = request.a.id
		///unless announce and implied_port is zero
		let node = this.makeNode(queryNodeID, rinfo.port, rinfo.host) //if id in dht returns existing node

		if(pack.y == 'q') {
			switch(packet.r) {
			case 'ping' :
				response = node._respPing(request)
				this._sendResponse(response, node.port, node.host)
				break
			case 'find_node' :
				response = node._respFindNode(request)
				this._sendResponse(response, node.port, node.host)
				break
			case 'get_peers' :
				response = node._respGetPeers(request)
				this._sendResponse(response, node.port, node.host)
				break
			case 'announce_peers' :
				response = node._respAnnounce(req, rinfo.port, rinfo.address)
				this._sendResponse(response, node.port, node.host)
				break
			default :
				response = {'t':request.t, 'y':'e', 'e':[204, "Method Unknown"]}
				this._sendResponse(response, node.port, node.host)
			}
		} 
	}

	_sendResponse(request, port, host) {

		let msg = benEncode(request)
		this.sock.send(msg, port, host)

	}

	//build responses using findNode and getPeers
	_respPing(request) {

		return {'t': request.t, 'y': 'r', 'r': {'id' : this.myNodeID}}

	}

	_respFindNode(request) {

		let [[node], nodes] = this.findNode(request.a.target) //node is targetnode if present in dht
		let contactInfoString

		if(node && node.nodeID != request.a.id) //if have node different from query node, return only that node
			contactInfoString = node.getContactInfo() 
		else 
			contactInfoString = nodes.map(node=> node.getContactInfo() ).join("")

		return {'t': request.t, 'y':'r', 'r': {'id' : this.myNodeID, 'nodes': contactInfoString}}

	}

	_respGetPeers(request) {

		let [peers, nodes] = this.getPeers(request.a.infoHash) //ignore node
		let response = {'t': request.t, 'y':'r', 'r' : {'id' : this.myNodeID, 'token': this.getToken(this.host) }}
		
		if(peers)
			response.r.values = peers.map(peer => peer.getContactInfo())
		else if(nodes)
			response.r.nodes = nodes.map(node => node.getContactInfo()).join("") 

		return response

	}

	_respAnnounce(request, impliedPort, host) {

		let token = request.a.token

		if(!this.isTokenValid(token, host))
			return {'t': request.t, 'y': 'e', 'e': [203,"Bad Token"]} 

		let port = request.a.implied_port != 0 ? impliedPort : request.a.port
		this.infoHashes[request.a.info_hash].push(new Peer(port, this.host, request.a.id))

		return {'t': request.t, 'y':'r', 'r' : {'id': this.myNodeID}}	

	}

}

class Bucket {

	constructor(min, max) {

		this.min = min //[min, max)
		this.max = max
		this.nodeIDs = []
		this.nodes = []
	}

	fits(id) { //nodeID or infoHash

		return id >= this.min & id < this.max

	}

	contains(nodeID) { //only nodeID

		return this.nodeIDs.any((bucketNodeID) => bucketNodeID == nodeID)

	}

	isEmpty() {

		return this.nodes.length == 0

	}

	isFull() {

		return this.nodes.length == 8

	}

	insert(nodeID) {

		if(this.nodeIDs.length < 8) {
			this.nodeIDs.push(nodeID)
			this.nodeIDs.sort((nodeID1, nodeID2) => nodeID1 > nodeID2)
		} 

	} 

	remove(nodeID) {

		pos = this.nodeIDs.findIndex(nodeID)
		this.nodeIDs.splice(pos, 1)

	}

	has(nodeID) {

		return this.nodeIDs.includes( nodeID )
		//return this.nodeIDs.find( (bucketNodeID) =>  bucketNodeID == nodeID)

	}

	getBucketNodeIDs() { //deepcopy

		return Object.assign([], this.nodeIDs) //new list of references

	}

	split() {  //splits at 

		b1 = new Bucket(this.min, this.min + (this.max - this.min)/2)
		b2 = new Bucket(this.min + (this.max - this.min)/2, this.max)

		this.nodeIDs.forEach(nodeID => {
			if(b1.contains(nodeID))
				b1.insert(nodeID)
			else 
				b2.insert(nodeID)
		})

		return [b1,b2]

	}
}

class Node {

	constructor(nodeID, port, host, myNodeID, sock) {//, dht) {

		this.nodeID = nodeID
		this.port = port
		this.host = host
		this.myNodeID = myNodeID//dht.myNodeID
		this.sock = sock
		this.default_timeout = 10000
		//this.dht = dht
		//this.sock = sock

		//only if in dht or questionable list
		this.everResp = false // ever
		this.resp15min = false //15 mins
		this.query15min = false //15 mins
		this.lastQueryTime
		this.lastRespTime
		this.respTimer
		this.queryTimer
		this.good = this.resp15min || (this.everResp && this.query15min)
		this.bad = false

		//this.inDHT = false

		//single string
		this.parseNodeContactInfos = function parseNodeInfos(compactInfosString) {

			var parseNodeInfo = (info) => makeNode(info.slice(0,20), info.slice(24,26), info.slice(20,24))
			return compactInfosString.toString().match(/.{26}/g).map(info => parseNodeInfo(info))

		}

		//list of strings
	
	}

	parsePeerContactInfos(compactInfos, nodeID) {

		return compactInfos.map(info => new Peer(info.slice(0,2), info.slice(2,6), nodeID))

	}

	get state() {

		if(this.bad) return NODE_STATE.BAD
		if(this.good) 
			return NODE_STATE.GOOD
		else 
			return NODE_STATE.QUES
		  //this.bad only when insertNodeInDHT pings ques nodes or when dht attempts to query node	

	}

	update(port, host) {

		this.port = port
		this.host = host
		return this

	}

	resetQueryTimer() {

		clearTimeout(this.queryTimer)
		this.lastReqTime = Date.now()
		self = this
		this.queryTimer = setTimeout(()=>{self.query15min = false}, 15 * 60 * 1e3)

	}

	resetRespTimer() {
		let self = this
		clearTimeout(self.respTimer)
		this.everResp = true
		this.lastRespTime = Date.now()
		this.respTimer = setTimeout(() => {self.respTimer = false}, 15 * 60 * 1e3)

	}

	getContactInfo() {
		let contactInfo = Buffer.concat([this.nodeID, Buffer.alloc(6)])
		contactInfo.writeUInt32BE(this.host, 20)
		contactInfo.writeUInt16BE(this.port, 24)
		return contactInfo
	}

	async ping() {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'ping', 'a': {'id': this.myNodeID}}
		//{t: id, y: r, r:{id: ___}}
		let response = await this._sendRequest(request)
		//if(response) this.resetQueryTimer()
		//this.resetRespQueryTimer()
		return response.r.id


	}

	//returns list of nodes - used to populate dht
	async findNode(targetNodeID) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y' : 'q', 'q' : 'find_node', 'a' : {'id': this.myNodeID, 'target': targetNodeID}}
		let response = await this._sendRequest(request)
		return this.parseNodeContactInfos(response.r.nodes)

	}

	//used to get peer contacts
	async getPeers(infoHash) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'get_peers', 'a' : {'id': this.myNodeID, 'infoHash':infoHash}}
		let response
		
		response = await this._sendRequest(request) 

		this.token = response.r.token
		let peer, nodes
	
		if(response.r.values)
			peers = this.parsePeerContactInfos(response.r.values, response.r.id)
		if(response.r.nodes)
			nodes = this.parseNodeContactInfos(response.r.nodes)
		return [ peers, nodes ]

	}

	//used to announce
	async announcePeer(infoHash, port) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'announce_peer', 'a' : {'id': this.myNodeID, 'implied_port': 1,
		'infoHash': infoHash, 'port': port, 'token': this.token}}

		response = await this._sendRequest(request)
		return response.r.id

	}

	
	//send request, setup listener to recieve response and resolve promise, return promise
	_sendRequest(request) {

		return new Promise( (resolve, reject) => {

			let self = this

			let timeout = setTimeout(()=>{
				self.sock.removeListener('message', listener)
				//set bad on multiple timeouts
				self.bad = true 
				reject(new Error('Timeout: ' + self.default_timeout +' (ms)'))
			} , this.default_timeout)

			let listener = (msg, rinfo) => {
				
				let response = benDecode(msg)
				if(response.t.equals(request.t)) { //might be y = r or y = e

					clearTimeout(timeout)
					self.sock.removeListener('message', listener)

					if(response.y.toString() == 'r') {

						self.resetRespTimer()
						resolve(response)

					} else if(response.y.toString() == 'e')

						reject(new Error(response.e[0] + ": " + response.e[1]))
						//maybe set bad

				}
			}

			this.sock.on('message', listener)

			let msg = benEncode(request)
			this.sock.send(msg, this.port, this.host)

		})
	}

}

module.exports = {
	'DHT' : DHT,
	'Node' : Node, 
	'Bucket' : Bucket
}