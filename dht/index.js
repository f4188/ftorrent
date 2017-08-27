
dgram = require('dgram')
crypto = require('crypto')
xor = require('buffer-xor')

benDecode = require('bencode').decode
benEncode = require('bencode').encode

Peer = require('../lib/peerinfo.js').PeerInfo
NSet = require('../lib/NSet.js').NSet

const NODE_STATE = { GOOD: 0, QUES : 1, BAD : 2}

var flatten = (list) => list.reduce((a,b) => a.concat(b), []) 

//var	xorCompare = (id) => (nodeID1, nodeID2) => parseInt(xor(nodeID1 , id).toString('hex'), 16) > parseInt(xor(nodeID2 , id).toString('hex'), 16)
//var	xorCompare = (id) => (node1, node2) => parseInt(xor(new Buffer(node1.nodeID, 'hex') , id).toString('hex'), 16) - parseInt(xor(new Buffer(node2.nodeID, 16) , id).toString('hex'), 16)
//var	xorCompareIDs = (id) => (node1, node2) => parseInt(xor( new Buffer(node1, 'hex') , new Buffer(id, 'hex') ).toString('hex'), 16) - parseInt( xor(new Buffer(node2, 'hex') , new Buffer(id, 'hex') ).toString('hex'), 16)

var	xorCompareIDStrings = (id) => (node1, node2) => parseInt(node1, 16) ^ parseInt(id, 16) - parseInt(node2, 16) ^ parseInt(id, 16)
var xorCompareIDs = xorCompareIDStrings
var xorCompare = xorCompareIDStrings

var makeNode

class TimeoutError extends Error {}
class KRPCError extends Error {}

class DHT {

	constructor(port, host, sock) {

		//buckets = [ [first level], [second level], ... ]
		// {  1st lvl  (s) , _________________________________}  0 to 2^160
		//                  {   2nd lvl  (s), ________________}  0 to 2^159, 2^159 to 2^160
		//                                  {____, (s) 3rd lvl}  0 to 2^159  2^159 to 2^159+2^158
		//                                   mynode
		/*class NMap {
			constructor(...args) {
				this.map = new Map()
			}

			get(key) { this.map.get(key.toString('hex')) }
			set(key, value) { this.map.set(key.toString('hex'), value)}
		}*/

		this.nodes = new Map() //NMap()

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

		this.sock.setMaxListeners(400)
		this.sock.on('message', (this._recvRequest).bind(this))	

		this.newToken = {} //new token every five minutes
		this.oldToken = {} //replaced with newToken

		this.refreshLoop = null

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
		//(nodeID, port, host, myNodeID, sock)
		var _makeNode = () => {

			return (nodeID, port, host) => {
				//console.log('nodeID',nodeID)
				let node = this.nodes.get(nodeID)

				if(!node) {

					node = new Node(nodeID, port, host, this.myNodeID, this.sock)
					this.nodes.set(nodeID, node)

				} else {

					node.update(port, host)

				}
			
				if(!this._inDHT(nodeID)) 

					this.insertNodeInDHT(nodeID)
				
				return node.nodeID
			}
		}

		this.makeNode = _makeNode()
		makeNode = this.makeNode

		this.loadDHT()

	}

	refreshBuckets() {

		this.buckets.forEach( bucket => {

			let lastChanged = Math.max(bucket.lastChanged, ...bucket.nodeIDs.map( nodeID => this.getNode(nodeID).lastChanged ))
			
			if(Date.now() - lastChanged > 15 * 60 * 1e3) {
				let rand = Math.floor(Math.random() * this.bucket.nodeIDs.length)
				this.findNodeIter(bucket.nodeIDs[rand]).catch( err => console.log("Refresh:", err))	
			}

		})

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

		return new Promise( (resolve, reject) => {
			dns.lookup(url, (error, address, family) => {
				if(error) 
					reject(error)
				else 
					resolve(address)
			})
		})

	}

	async bootstrap() {
		
		this.myNodeID = crypto.randomBytes(20).toString('hex')
		this.makeNode(this.myNodeID ,this.port, this.host)

		let bootstrapNodeAddrs = [[6881, 'router.bittorrent.com'], [6881, 'dht.transmissionbt.com'], [6881, 'router.utorrent.com']]
		
		let ips = await Promise.race(bootstrapNodeAddrs.map( node =>  this.lookup(node[1])))

		let bootStrapNode = new Node("", 6881, ips, this.myNodeID, this.sock) //do not insert in routing table

		let nodes
		let tries = 0

		//while( tries++ < 5 && !nodes) {
		while(!nodes) {

			try {

				nodes = await bootStrapNode.findNode(this.myNodeID) // inserts nodes in dht 
			
			} catch (error) {

				if(error instanceof TimeoutError && tries >= 5)
					throw new TimeoutError('bootstrap node timeout')
				else
					throw new Error("bootstrap node error")

			}

		}

		let ret = await this.findNodeIter(this.myNodeID) //builds dht

		this.refreshLoop = setInterval((this.refreshBuckets).bind(this), 15 * 60 * 1e3)

		return ret

	}

	saveDHT() {

	}

	//returns [peers] and inserts this peer into mainline DHT
	async announce(infoHash) {

		let [peers, nodes] = await getPeersIter(infoHash)

		nodes.forEach(node => node.announcePeer(infoHash, this.port))
		
		return peers

	}

	async findNodeIter(nodeID)  {

		return new Promise( (resolve, reject) => {

			let [[node], nodes] = this.findNode(nodeID)
			//if(nodeID == this.myNodeID) 
			//	node = undefined

			let allNodes = new NSet(nodes), queriedNodes = new NSet()
			let kClosest = nodes, kClosestCount = 0

			var query = (node) => {

				if(kClosestCount >= 8)
					return

				queriedNodes.add(node)

				this.getNode(node).findNode(nodeID).then( result => {

					result = result.filter( id => id != this.myNodeID )
					allNodes = allNodes.union(new NSet(result))
					querySuccess()

				}).catch( (err) => { 

					queryFail(node)
				
				})

			}

			var successTest = () => {

				let closestSoFar = Array.from(allNodes).sort(xorCompareIDs(nodeID)).slice(0, 8)
				if( (new NSet(kClosest)).intersection(new NSet(closestSoFar)).size == 8 )
					kClosestCount++
				else 
					kClosestCount = 0
				
				kClosest = closestSoFar
				
				//console.log("myNodeID:", this.myNodeID, kClosestCount)
				//console.log("kClosest:", kClosest.sort( xorCompareIDs(nodeID) ))

				if(kClosestCount >= 8)
					resolve([null, kClosest]) //called only once
				if(closestSoFar.findIndex( id => id == nodeID) != -1) {
					kClosestCount = 8
					resolve([nodeID, kClosest])
				}

			}

			var querySuccess = () => {

				if(kClosestCount >= 8)
					return

				successTest()

				let closestUnqueried = Array.from(allNodes.difference(queriedNodes)).sort(xorCompareIDs(nodeID)).slice(0, 8)
				closestUnqueried.slice(0,1).forEach(node => query(node))

			}

			var queryFail = (node) => {

				if(kClosestCount >= 8)
					return

				Array.from(allNodes.difference(queriedNodes)).sort(xorCompareIDs(nodeID)).slice(0, 1).forEach(node => query(node))

			}

			allNodes.forEach( node => query(node) )

		})
			
	}

	async getPeersIter(nodeID) {

		return new Promise( (resolve, reject) => {

			let allPeers = []
			let [peers, nodes] = this.getPeers(nodeID)

			let allNodes = new NSet(nodes), queriedNodes = new NSet()
			let kClosest = nodes, kClosestCount = 0, peerCount = 0

			var query = (node) => {

				if(kClosestCount >= 8)
					return

				queriedNodes.add(node)

				this.getNode(node).getPeers(nodeID).then( result => {

					let [peers, nodes] = result
					allNodes = allNodes.union(new NSet(nodes))
					querySuccess(peers, nodes)

				}).catch( (err) => { 
					//console.log(err)
					queryFail(node)
				
				})

			}

			var successTest = (peers, nodes) => {

				let closestSoFar = Array.from(allNodes).sort(xorCompareIDs(nodeID)).slice(0, 8)
				if( (new NSet(kClosest)).intersection(new NSet(closestSoFar)).size == 8 )
					kClosestCount++
				else 
					kClosestCount = 0
				
				kClosest = closestSoFar
				if(peers)
					allPeers = allPeers.concat(peers)
				console.log(peers)
			
				if(kClosestCount >= 8)
					resolve([allPeers, kClosest]) //called only once

			}

			var querySuccess = (peers, nodes) => {

				if(kClosestCount >= 8)
					return

				successTest(peers, nodes)

				let closestUnqueried = Array.from(allNodes.difference(queriedNodes)).sort(xorCompareIDs(nodeID)).slice(0, 8)
				closestUnqueried.slice(0,1).forEach(node => query(node))

			}

			var queryFail = (node) => {

				if(kClosestCount >= 8)
					return

				Array.from(allNodes.difference(queriedNodes)).sort(xorCompareIDs(nodeID)).slice(0, 1).forEach(node => query(node))
				//if no nodes found and no nodes left silent exit
				//if 8 silent fails then reject()

			}

			allNodes.forEach( node => query(node) )

		})
			
	}

	getPeers(infoHash) {

		let [node, nodes, hasMyNode] = this._getClosestNodes(infoHash)
		let peers// = []
		if(hasMyNode)
			peers = this.infoHashes[infoHash]
		return [peers, nodes]

	}
 	
	findNode(nodeID) { 

		let [node, nodes, hasMyNode] = this._getClosestNodes(nodeID)
		return [[node], nodes]

	}

	_getClosestNodes(id) { 

		let nodeIDs = flatten(this.buckets.map(bucket => bucket.getBucketNodeIDs())) //.reduce((a,b) => a.concat(b))
		
		nodeIDs.sort(xorCompareIDs(id))
		let kClosestNodeIDs = nodeIDs.slice(0, 10)

		let node, myNode, hasMyNodeID

		let pos = kClosestNodeIDs.findIndex( (nodeID) => nodeID == id )
		if(pos != -1)
			node = kClosestNodeIDs.splice(pos, 1)[0]

		pos = kClosestNodeIDs.findIndex( nodeID => nodeID == this.myNodeID )
		if(pos != -1) {
			kClosestNodeIDs.splice(pos, 1)
			hasMyNodeID = true
		}

		return [node, kClosestNodeIDs.slice(0, 8), hasMyNodeID]

	}

	getNode(nodeID) {

		return this.nodes.get(nodeID)

	}

	insertNodeInDHT(nodeID) {

		let node = this.getNode(nodeID)
		let bucket = this._findBucketFits(nodeID)

		if(!bucket.isFull()) { 

			bucket.insert(nodeID)

		} else if(bucket.has(this.myNodeID)) {
			
			bucket.insert(nodeID)
			this.buckets.pop()

			while(bucket.has(this.myNodeID) && bucket.isFull()) {

				let [b1, b2] = bucket.split()
				if(b1.has(this.myNodeID)) {
					this.buckets.push(b2)
					this.buckets.push(b1)
				} else {
					this.buckets.push(b1)
					this.buckets.push(b2)
				}

				bucket = this.buckets.pop()
			}

			this.buckets.push(bucket)

		} else { //doesn't already contain node and is full

			//this.replaceNodesInDHT(nodeID, node, bucket)

		}
		
	}

	async replaceNodesInDHT (nodeID, node, bucket) {

		if(!bucket.isFull() || bucket.has(this.myNodeID)) return 

		let quesNodeIDs = bucket.getBucketNodeIDs().filter( (id) => this.getNode(id).state != NODE_STATE.GOOD)
		quesNodeIDs.sort( (id1, id2 ) => this.getNode(id1).lastRespReq - this.getNode(id2).lastRespReq )

		let aQuesNodeID = quesNodeIDs.shift()

		while( quesNodeIDs.length > 0 ) {

			try {

				await this.getNode(aQuesNodeID).ping()
				
			} catch (error) {

				bucket.remove(aQuesNodeID)

				if(!bucket.has(nodeID) & !bucket.isFull())
					bucket.insert(nodeID)

				return 

			}

			aQuesNodeID = quesNodeIDs.shift()	

		}

	}

	_inDHT(id) {

		this.foo = id
		return this._findBucketFits(id).has(id)

	}

	_findBucketFits(id) {

		return this.buckets.find((bucket) => bucket.fits(id)) //always returns a bucket

	}

	_recvRequest(msg, rinfo) {

		let request

		try {

			request = benDecode(msg) // return 203 if malformed

		} catch (error) {

			return

		}

		let response
				
		if(request.y == 'q') {
			this.req = request

			let queryNodeID = request.a.id.toString('hex')

			let node = this.getNode(makeNode(queryNodeID, rinfo.port, rinfo.address)) //if id in dht returns existing node

			switch(request.q.toString()) {
				case 'ping' :
					response = this._respPing(request)
					this._sendResponse(response, node.port, node.host)
					break
				case 'find_node' :
					response = this._respFindNode(request)
					this._sendResponse(response, node.port, node.host)
					break
				case 'get_peers' :
					response = this._respGetPeers(request)
					this._sendResponse(response, node.port, node.host)
					break
				case 'announce_peer' :
					response = this._respAnnounce(req, rinfo.port, rinfo.address)
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

	_respPing(request) {

		return {'t': request.t, 'y': 'r', 'r': {'id' : new Buffer(this.myNodeID, 'hex')}}

	}

	_respFindNode(request) {

		let [[nodeID], nodeIDs] = this.findNode(request.a.target.toString('hex')) //node is targetnode if present in dht
		let contactInfoString

		if(nodeID != request.a.id && this.getNode(nodeID)) //if have node different from query node, return only that node
			contactInfoString = this.getNode(nodeID).getContactInfo() 
		else 
			contactInfoString = nodeIDs.map( id => this.getNode(id).getContactInfo() ).join("")

		return {'t': request.t, 'y':'r', 'r': {'id' : new Buffer(this.myNodeID, 'hex'), 'nodes': contactInfoString}}

	}

	_respGetPeers(request) {

		let [peers, nodeIDs] = this.getPeers(request.a.info_hash.toString('hex')) //ignore node
		let response = {'t': request.t, 'y':'r', 'r' : {'id' : new Buffer(this.myNodeID, 'hex'), 'token': this.getToken(this.host) }}
		
		if(peers)
			response.r.values = peers.map(peer => peer.getContactInfo())

		response.r.nodes = nodeIDs.map( id => this.getNode(id).getContactInfo()).join("") 

		return response

	}

	_respAnnounce(request, impliedPort, host) {

		let token = request.a.token

		if(!this.isTokenValid(token, host))
			return {'t': request.t, 'y': 'e', 'e': [203,"Bad Token"]} 

		let port = request.a.implied_port != 0 ? impliedPort : request.a.port

		this.infoHashes[request.a.info_hash.toString('hex')].push(new Peer(port, this.host, request.a.id))

		return {'t': request.t, 'y':'r', 'r' : {'id': new Buffer(this.myNodeID, 'hex')}}	

	}

}

class Bucket {

	constructor(min, max) {

		this.min = min //[min, max)
		this.max = max
		this.nodeIDs = []
		this.lastInsertTime = null

	}

	get lastChanged() {

		return this.lastInsertTime
	
	}

	fits(id) { //nodeID or infoHash

		let num = parseInt('0x' + id)//Buffer.from(id).toString('hex'))
		return num >= this.min && num < this.max 

	}

	contains(nodeID) { //only nodeID

		return this.nodeIDs.some((bucketNodeID) => bucketNodeID == nodeID)

	}

	isEmpty() {

		return this.nodeIDs.length == 0

	}

	isFull() {

		return this.nodeIDs.length >= 8

	}

	insert(nodeID) {

		this.lastInsertTime = Date.now()
		this.nodeIDs.push(nodeID)
		this.nodeIDs.sort((nodeID1, nodeID2) => parseInt('0x'+nodeID1) - parseInt('0x'+nodeID2))

	} 

	remove(nodeID) {

		let pos = this.nodeIDs.findIndex( id => id == nodeID)
		this.nodeIDs.splice(pos, 1)

	}

	has(nodeID) {

		return this.nodeIDs.includes( nodeID )

	}

	getBucketNodeIDs() { //deepcopy

		return Object.assign([], this.nodeIDs) //new list of references

	}

	split() {  //splits at 

		let b1 = new Bucket(this.min, this.min + (this.max - this.min)/2)
		let b2 = new Bucket(this.min + (this.max - this.min)/2, this.max)

		this.nodeIDs.forEach(nodeID => {
			if(b1.fits(nodeID))
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
		this.default_timeout = 2000

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
		this.numNoResp = 0

		this.parseNodeContactInfos = function parseNodeInfos(compactInfos) {

			var slicer = (buf) => {
				let slices = []
				while(buf.length > 0) {
					slices.push(buf.slice(0,26))
					buf = buf.slice(26)
				}
				return slices
			}

			return slicer(compactInfos).map(info => {

				let parsedHost = info.slice(20,24).toString('hex').match(/.{2}/g).map( num => Number('0x'+num)).join('.') //: host.toString().match(/.{2}/g).map( num => Number(num)).join('.')
				let parsedPort = info.slice(24,26).readUInt16BE()

				return makeNode(info.slice(0,20).toString('hex'), parsedPort, parsedHost)
			
			})

		}
	
	}

	get lastRespReq() {

		return Math.max(this.lastQueryTime, this.lastRespTime)

	}

	parsePeerContactInfos(compactInfos, nodeID) {

		var slicer = (buf) => {
			let slices = []
			while(buf.length > 0) {
				slices.push(buf.slice(0, 6))
				buf = buf.slice(6)
			}
			return slices
		}

		return compactInfos.map(info => {

			let parsedHost = info.slice(0,4).toString('hex').match(/.{2}/g).map( num => Number('0x' + num)).join('.') //: host.toString().match(/.{2}/g).map( num => Number(num)).join('.')
			let parsedPort = info.slice(4, 6).readUInt16BE()

			return new Peer(parsedPort, parsedHost)

		})

	}

	get state() {

		if(this.bad) return NODE_STATE.BAD
		if(this.numNoResp > 4) return NODE_STATE.BAD
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
		this.lastQueryTime = Date.now()
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

		let portBuf = new Buffer(2)
		portBuf.writeUInt16BE(this.port)
		let contactInfo = Buffer.concat([Buffer.from(this.nodeID, 'hex'), Buffer.from(this.host.split('.')), portBuf])
		return contactInfo

	}

	async ping() {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'ping', 'a': {'id': Buffer.from(this.myNodeID,'hex')}}
		let response
		let then = Date.now()

		try {

			response = await this._sendRequest(request)
		
			return Date.now() - then

		} catch(error) {

			if(error instanceof TimeoutError)
				this.numNoResp++

			throw error
		} 
	}

	//returns list of nodes - used to populate dht
	async findNode(targetNodeID) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y' : 'q', 'q' : 'find_node', 'a' : {'id': Buffer.from(this.myNodeID,'hex'), 'target': Buffer.from(targetNodeID,'hex')}}

		let response

		try {

			response = await this._sendRequest(request)
			let tNode = response
			return this.parseNodeContactInfos(response.r.nodes) //returns list not pair

		} catch (error) {

			if(error instanceof TimeoutError)
				this.numNoResp++

			throw error

		}

	}

	//used to get peer contacts
	async getPeers(infoHash) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'get_peers', 'a' : {'id': Buffer.from(this.myNodeID,'hex'), 'info_hash' : Buffer.from(infoHash, 'hex')}}
		let response
		
		try {

			response = await this._sendRequest(request)
			//console.log("response",response)
			this.token = response.r.token
			let peers, nodes
		
			if(response.r.nodes)
				nodes = this.parseNodeContactInfos(response.r.nodes)
			if(response.r.values)
				peers = this.parsePeerContactInfos(response.r.values, response.r.id)

			return [ peers, nodes ]

		} catch( error ) {

			if(error instanceof TimeoutError) 
				this.numNoResp++
			
			throw error

		}

	}

	//used to announce
	async announcePeer(infoHash, port) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'announce_peer', 'a' : {'id': Buffer.from(this.myNodeID,'hex'), 'implied_port': 1,
		'infoHash': infoHash, 'port': port, 'token': this.token}}

		response = await this._sendRequest(request)
		return response.r.id

	}

	//send request, setup listener to recieve response and resolve promise, return promise
	_sendRequest(request) {

		return new Promise( (resolve, reject) => {

			let self = this

			let timeout = setTimeout( ()=> {

				self.sock.removeListener('message', listener)
				reject("Timeout: " + self.default_timeout + " (ms)")

			} , this.default_timeout)

			let listener = (msg, rinfo) => {
				
				let response

				try {
					
					response = benDecode(msg)

				} catch (error) {

					return

				}

 				if(response.t && response.t.equals(request.t)) { //buffers

					clearTimeout(timeout)
					self.sock.removeListener('message', listener)

					if(response.y.toString() == 'r') {

						self.resetRespTimer()
						resolve(response)

					} else if(response.y.toString() == 'e')

						reject(new KRPCError(response.e[0] + ": "+ response.e[1]))
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
	'Node' : Node
}