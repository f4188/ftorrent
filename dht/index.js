
/*
myNode : handles requests from other nodes
nodes = [node1, node2, node3]
nodei handles requests to nodei from DHT 


use myNode to send requests and recv responses

*/

//need to replace
dgram = require('dgram')
crypto = require('crypto')

benDecode = require('bencode').decode
benEncode = require('bencode').encode

const NODE_STATE = { GOOD: 0, QUES : 1, BAD : 2}

function makeDHT() {

	let dht = new DHT(myNode)
	dht.load()
	return dht

}

class DHT {

	constructor(port, host, sock) {

		//buckets = [ [first level], [second level], ... ]
		// {  1st lvl  (s) , _________________________________}  0 to 2^160
		//                  {   2nd lvl  (s), ________________}  0 to 2^159, 2^159 to 2^160
		//                                  {____, (s) 3rd lvl}  0 to 2^159  2^159 to 2^159+2^158
		//                                   mynode
		//this.levels = 0

		this.nodes = new Map()
		this.buckets = [new Bucket(0, Math(2,160))]
		this.myNodeID

		this.infoHashes = {} //{infoHash1 : [peerlist... ], infoHash2 : [peerlist...]}
		
		this.default_timeout = 500
		this.port = port
		this.host = host

		if(sock)
			this.sock = sock
		else {
			this.sock = dgram.createSocket('udp4')
			this.sock.bind(port)
		}

		this.sock.on('message', this._recvRequest)	

		this.newToken //new token every five minutes
		this.oldToken //replaced with newToken

		self = this

		var _tokenUpdater = function tknUpdtr() {

			self.oldToken = self.newToken
			//self.newToken.value = crypto.randomBytes(8)
			hash = crypto.createHash('sha1')
			self.newToken.value = hash.update(this.host).digest('hex') + crypto.randomBytes(4)
			self.newToken.hosts = new Set()

		}

		_tokenUpdater()

		this.tokenInterval = setInterval(_tokenUpdater, 5*60*1e3)

		var _makeNode = function() {

			function makeNode(nodeID, port, host) {
				
				let node = this.nodes.get(nodeID)
				if(!node) {
					node = new Node(nodeID, port, host, this)
					this.nodes.put(node)
				} else {
					node.update(port, host)
				}
			
				if(!node.inDHT) this.insertNodeInDHT(nodeID)

				return node 
			}
		}

		this.makeNode = _makeNode()

	}

	getToken(host) {

		this.newToken.hosts.add(host)		
		return this.newToken.value

	}

	isTokenValid(token, host) {

		if(this.newToken.hosts.has(host) && this.newToken.value = token
			|| this.oldToken.hosts.has(host) && this.newToken.value = token) //
			return true
		else 
			return false

	}


	//load dht from storage
	loadDHT() {

	}

	saveDHT() {

	}

	//INCOMPLETE
	//returns [peers] and inserts this peer into mainline DHT
	async announce(infoHash) {

		Set.prototype.difference = (setB) => {

			let difference = new Set(this)
			for (var elem of setB) difference.delete(elem)
			return difference

		}

		let [peers, nodes] = this.getPeers(infoHash) //k closest nodes
		let newNodes, oldNodes
		newNodes = new Set(nodes)

		//while( newNodes.difference(oldNodes).size > 0 ) { //nodes unchanged
		while( newNodes.size > 0) {

			oldNodes = newNodes// new Set(nodes)

			//results = [[peers, nodes], ...]
			newNodes.difference(oldNodes)

			results = nodes.map(node => { //returns promise that resolve to getPeers or false

				let result
				try {
					result = await node.getPeers() //
				} catch(error) {
					return false
				}
				return result

			}) 
			
			results = await Promise.all(results)
			results = results.filter(result => result)
			
			peers = peers.concat(flatten(results.map(result => result[0])))
			nodes = nodes.concat(flatten(results.map(result => result[1])))

			nodes.sort(xorCompare(infoHash))

			//not all these nodes are good
			newNodes = new Set(nodes.slice(8)) 
			newNodes = newNodes.difference(oldNodes)

		}

		for( let node of oldNodes.values() ) {
			node.announcePeer(infoHash, this.port)
		}

		//{'t': request.t, 'y':'r', 'r':{'id': this.nodeID}}	
		//{'t': request.t, 'y':'r', 'r' :{'target': request.a.target, 'token': myNode.getToken(this.host) }}


	}

	xorCompare(id) {

		return (nodeID1, nodeID2) => (nodeID1 ^ id) > (nodeID2 ^ id)

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
		return [node, nodes]

	}

	_getClosestNodes(id) { 

		let nodeIDs = this.buckets.map(bucket => bucket.getBucketNodeIDs()).reduce((a,b) => a.concat(b) )
		nodeIDs.sort(xorCompare(id))
		let kClosestNodeIDs = nodeIDs.slice(10)
		let node, myNode, hasMyNodeID
		let pos = kClosestNodes.findIndex((nodeID)=> nodeID == id)

		if(pos != -1)
			node = getNode(kClosestNodes.splice(pos, 1))
		pos = kClosestNodes.findIndex(this.myNodeID)

		if(pos != -1) {
			kClosestNodes.splice(pos, 1)
			hasMyNodeID = true
		}

		return [node, nodeIDs.slice(8).map(nodeID => getNode(nodeID)), hasMyNodeID]

	}

	//returns node if in DHT otherwise returns undefined
	//getNodeInDHT(nodeID) {
	//	return this._findBucketFits(nodeID).get(nodeID)
	//}

	getNode(nodeID) {

		return this.nodes.get(nodeID)

	}

	insertNodeInDHT(nodeID) {

		node = this.getNode(nodeID)

		let bucket = this._findBucketFits(nodeID)

		if(!bucket.isFull()) {

			bucket.insert(nodeID)
			node.inDHT = true

			if(bucket == this.buckets.slice(-1)) { //bucket with myNode
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

				return
			}

		} else { //doesn't already contain node and is full
			//ping questionable nodes
			quesNodeIDs = bucket.getNodes().filter( (id) => getNode(id).state() != NODE_STATE.GOOD)
			quesNodeIDs.sort( (id) => Math.max(getNode(id).lastReqTime, getNode(id).lastRespTime))

			aQuesNodeID = quesNodeIDs.shift()

			while( queryNodeIDs.length != 0 ) {

				try{

					await getNode(aQuesNodeID).ping()
					
				} catch (error) {

					bucket.remove(aQuesNodeID)
					getNode(aQuesNodeID).inDHT = false

					bucket.insert(node)
					node.inDHT = true
					return 

				}

				aQuesNodeID = quesNodeIDs.shift()	

			}

		}
		//not insert - still in this.nodes
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
				response = node.respPing(request)
				self._sendResponse(response, node.port, node.host)
				break
			case 'find_node' :
				response = node.respFindNode(request)
				self._sendResponse(response, node.port, node.host)
				break
			case 'get_peers' :
				response = node.respGetPeers(request)
				self._sendResponse(response, node.port, node.host)
				break
			case 'announce_peers' :
				response = node.respAnnounce(req, rinfo.port, rinfo.address)
				self._sendResponse(response, node.port, node.host)
				break
			default :
				response = {'t':request.t, 'y':'e', 'e':[204, "Method Unknown"]}
				this._sendResponse(response, node.port, node.host)
			}
		} 
	}

	_sendResponse(request, port, host) {

		let msg = benEncode(request)
		self.sock.send(msg, port, host)

	}

	//build responses using findNode and getPeers
	respPing(request) {

		return {'t': request.t, 'y': 'r', 'r': {'id':this.nodeID}}

	}

	respFindNode(request) {

		[node, nodes] = this.findNode(request.a.target) //node is targetnode if present in dht
		contactInfoString = nodes.map(node=>{return node.getContactInfo()}).join("")

		if(node && node.nodeID != request.a.id)
			contactInfoString = node.getContactInfo() 

		return {'t': request.t, 'y':'r', 'r': {'target': request.a.target, 'nodes': contactInfoString}}

	}

	respGetPeers(request) {

		[peers, nodes] = this.getPeers(request.a.infoHash) //ignore node
		response = {'t': request.t, 'y':'r', 'r' :{'target': request.a.target, 'token': myNode.getToken(this.host) }}
		
		if(peers)
			response.r.values = peers.map(peer => peer.getContactInfo())
		else if(nodes)
			response.r.nodes = nodes.map(node => node.getContactInfo()).join("") 
		return response

	}

	respAnnounce(request, port, host) {

		let token = request.a.token

		if(!this.isTokenValid(token, host))
			return {'t': request.t, 'y': 'e', 'e': [203,"Bad Token"]} 

		let port = request.a.implied_port != 0 ? port : request.a.port
		this.infoHashes[request.a.info_hash].push(new Peer(port, this.host, request.a.id))

		return {'t': request.t, 'y':'r', 'r':{'id': this.nodeID}}	

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

	get(nodeID) {

		return this.nodeIDs.find((bucketNodeID)=>{return bucketNodeID == nodeID})

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

/*
* 
*/

class Node {

	constructor(nodeID, port, host, dht) {

		this.nodeID = nodeID
		this.port = port
		this.host = host
		this.myNodeID = dht.myNodeID
		this.dht = dht
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

		this.inDHT = false
	
	}

	state() {

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

		self.everResp = true
		clearTimeout(this.respTimer)
		this.lastRespTime = Date.now()
		self = this
		this.respTimer = setTimeout(()=>{self.respTimer = false}, 15 * 60 * 1e3)

	}

	getContactInfo() {
		let contactInfo = Buffer.concat([this.nodeID, Buffer.alloc(6)])
		contactInfo.writeUInt32BE(this.host, 20)
		contactInfo.writeUInt16BE(this.port, 24)
		return contactInfo
	}

	async ping() {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'name': 'ping', 'a': {'id': this.myNodeID}}
		//{t: id, y: r, r:{id: ___}}
		response = await this._sendRequest(request)
		//if(response) this.resetQueryTimer()
		//this.resetRespQueryTimer()
		return response.r.id

	}

	//returns list of nodes - used to populate dht
	async findNode(targetNodeID) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'name': 'find_node', 'a' : {'id': this.myNodeID, 'target': targetNodeID}}
		response = await this._sendRequest(request)
		return parseNodeContactInfos(response.r.nodes)

	}

	//used to get peer contacts
	async getPeers(infoHash) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'name': 'get_peers', 'a' : {'id': this.myNodeID, 'infoHash':infoHash}}
		response = await this._sendRequest(request) 
		this.token = response.r.token
		let peer, nodes
		if(response.r.values)
			peers = parsePeerContactInfos(response.r.values)
		if(response.r.nodes)
			nodes = parseNodeContactInfos(response.r.nodes)
		return [ peers, nodes ]

	}

	//used to announce
	async announcePeer(infoHash, port) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'name': 'announce_peer', 'a' : {'id': this.myNodeID, 'implied_port': 1,
		'infoHash': infoHash, 'port': port, 'token': this.token}}
		response = await this._sendRequest(request)
		return response.r

	}

	
	//send request, setup listener to recieve response and resolve promise, return promise
	_sendRequest(request, port, host) {

		return new Promise( (resolve, reject) => {
			self = this
			let timeout, listener

			timeout = setTimeout(()=>{
				self.sock.removeListener('message', listener)
				this.bad = true
				reject(new Error('Timeout: ' + self.default_timeout +' (ms)'))
			} , this.default_timeout)

			listener = (msg, rinfo) => {

				let response = benDecode(msg)
				if(response.t == request.t) { //might be y = r or y = e
					clearTimeout(timeout)
					self.sock.removeListener('message', listener)
					if(response.y == 'r') {
						this.resetRespTimer()
						resolve(reply)
					}
					else if(response.y == 'e')
						//maybe set bad??
						reject(new Error(response.e[0] + ": " + response.e[1]))
				}

			}
			self.sock.on('message', listener)

			let msg = benEncode(request)
			self.sock.send(msg, port, host)
		})
	}

}

//single string
var parseNodeContactsInfos = function parseNodeInfos(compactInfosString) {

	var parseNodeInfo = (info) => makeNode(info.slice(0,20), info.slice(24,26), info.slice(20,24))
	return compactInfosString.match(/.{26}/g).map(info => parseNodeInfo(info))

}

//list of strings
var parsePeerContactInfos = function parsePeerInfos(compactInfos) {

	return compactInfos.map(info => new Peer(info.slice(0,2), info.slice(2,6))

}

var flatten = (list) => list.reduce((a,b) => a.concat(b)) 

class Peer {

 	constructor(port,host,nodeID) {
 		this.port = port
 		this.host = host
 		this.nodeID = nodeID //owns this node 
 		
 		this.preferEncrypt = false
 		this.upLoadOnly = false
 		this.supportsUTP = false
 		this.supportsUTHolepunch = false
 		this.reachable = true
 	}

 	getContactInfo() {
		let contactInfo = Buffer.alloc(6)
		contactInfo.writeUInt32BE(this.host, 0)
		contactInfo.writeUInt16BE(this.port, 4)
		return contactInfo
	}

 }

