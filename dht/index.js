
const dgram = require('dgram')
const crypto = require('crypto')
const async = require('async')
const xor = require('buffer-xor')
const dns = require('dns')
EventEmitter = require('events').EventEmitter

benDecode = require('bencode').decode
benEncode = require('bencode').encode

Peer = require('../lib/PeerInfo.js').PeerInfo
parsePeerContactInfos = require('../lib/PeerInfo.js').parsePeerContactInfos
NSet = require('../lib/NSet.js').NSet

LOG = false

const NODE_STATE = { GOOD: 0, QUES : 1, BAD : 2}

var flatten = (list) => list.reduce((a,b) => a.concat(b), []) 

var xorCompare = (id) => (n1, n2) => {

	let idBuf =  new Buffer(id, 'hex')
	let c1 = xor(new Buffer(n1, 'hex'), idBuf)
	let c2 = xor(new Buffer(n2, 'hex'), idBuf)

	if( c1 < c2) 
		return -1
	else if(c1 > c2) 
		return 1
	else if(c1.equals(c2))
		return 0

}

var xorDistance = (id) => (nodeID) =>  parseInt(xor(new Buffer(nodeID, 'hex'), new Buffer(id, 'hex')), 16)

var readStreamFunc = async (path) => {

	return new Promise( (resolve, reject) => {

		let fileStream = fs.createReadStream(path)
		let fileData = new Buffer(0)
		fileStream.on('data', (data) => { fileData = Buffer.concat([fileData, data]) } )
		fileStream.on('end', () => { resolve(fileData) })

	})
}

class TimeoutError extends Error {}
class KRPCError extends Error {}

class DHT extends EventEmitter {

	constructor(port, host, sock) {

		super()
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

		this.repNodeWorkers = 0
		this.repNodeQueue = []

		let self = this

		var _tokenUpdater = function tknUpdtr() {

			self.oldToken = self.newToken
			let hash = crypto.createHash('sha1')
			self.newToken.value = hash.update(self.host.split('.').join("")).digest('hex') + crypto.randomBytes(4)
			self.newToken.hosts = new Set()

		}

		_tokenUpdater()

		this.tokenInterval = setInterval(_tokenUpdater, 5*60*1e3)

		this._makeNode = () => {

			return (nodeID, port, host) => {

				let node = this.nodes.get(nodeID)

				if(!node) {

					node = new Node(nodeID, port, host, this.myNodeID, this.sock, (this.parseNodeContactInfos).bind(this))
					this.nodes.set(nodeID, node)

				} else {

					node.update(port, host)

				}
			
				if(node.state != NODE_STATE.BAD && !this._inDHT(nodeID)) 

					this._insertNodeInDHT(nodeID)
				
				return node.nodeID
			}
		}

		this.makeNode = (this._makeNode()).bind(this)

	}

	refreshBuckets(force) {

		this.buckets.forEach( bucket => {

			let lastChanged = Math.max(bucket.lastChanged, ...(bucket.nodeIDs.map( nodeID => this._getNode(nodeID).lastRespReq )))
			
			if(Date.now() - lastChanged > 15 * 60 * 1e3 || force) {

				let rand = Math.floor(Math.random() * bucket.nodeIDs.length)
				let node 

				if(bucket.nodeIDs.length == 0) {

					let min = bucket.min
					let max = bucket.max
					let randIDNum = min + Math.random() * (max - min)
					let randID = randIDNum.toString(16)
					node = Buffer.from(randID, 'hex')

				} else {
					node = bucket.nodeIDs[rand]
				}

				this.findNodeIter(node).then( x=> { }).catch( err => {if(LOG) console.log("Refresh:", err)} )	 //dump nodes not in DHT
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

	saveDHT() {

		let self = this
		let buckets = this.buckets.map( bucket => { return { min : bucket.min, max : bucket.max, nodeIDs : bucket.nodeIDs } } ) 
		let nodesInBuckets = buckets.map( bucket => bucket.nodeIDs).reduce( (list, nodeIDs) => list.concat(nodeIDs), [])
		let nodeAddressBook = nodesInBuckets.reduce( ( soFar, id) => { soFar[id] = { port : self.nodes.get(id).port, host : self.nodes.get(id).host }; return soFar} , {})
		let saveFile = fs.createWriteStream('./saved_DHT')
		saveFile.write(JSON.stringify({buckets : buckets, addressBook : nodeAddressBook, myNodeID : this.myNodeID}))
		saveFile.end()


	}

	async loadDHT() {

		let savedData = await readStreamFunc('./saved_DHT')
		let DHTData = JSON.parse(savedData)
		this.myNodeID = DHTData.myNodeID
		this.makeNode = this._makeNode() //reset with myNodeID
		this.makeNode(DHTData.myNodeID, this.port, this.host)
		this.buckets = []
		let self = this
		DHTData.buckets.forEach( bucket => { self.buckets.push( new Bucket(bucket.min, bucket.max)) })
		DHTData.buckets.forEach(bucket => bucket.nodeIDs.forEach( id => self.makeNode(id, DHTData.addressBook[id].port, DHTData.addressBook[id].host)) )

		this.refreshBuckets(true) //async
		this.refreshLoop = setInterval((this.refreshBuckets).bind(this), 15 * 60 * 1e3)


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

	async bootstrap(log) {

		LOG = log// log ? log : false
		this.myNodeID = crypto.randomBytes(20).toString('hex')
		this.makeNode(this.myNodeID ,this.port, this.host)

		let bootstrapNodeAddrs = [[6881, 'router.bittorrent.com'], [6881, 'dht.transmissionbt.com'], [6881, 'router.utorrent.com']]		
		let ips = await Promise.race(bootstrapNodeAddrs.map( node =>  this.lookup(node[1])))
		let bootStrapNode = new Node("", 6881, ips, this.myNodeID, this.sock, (this.parseNodeContactInfos).bind(this)) //do not insert in routing table

		let nodes, node
		let tries = 0

		while(!nodes) {

			try {

				[[node], nodes] = await bootStrapNode.findNode(this.myNodeID) // inserts nodes in dht 
			
			} catch (error) {

				if(LOG)
					console.log(error)

				if(error instanceof TimeoutError && tries >= 5)
					throw new TimeoutError('bootstrap node timeout')
				else
					throw new Error("bootstrap node error")

			}

		}

		let ret = await this.findNodeIter(this.myNodeID) //builds dht

		this.refreshLoop = setInterval((this.refreshBuckets).bind(this), 15 * 60 * 1e3)
		this.refreshBuckets(true)

		return ret

	}

	//returns [peers] and inserts this peer into DHT
	async announce(infoHash, port) {

		let [peers, nodes] = await this.getPeersIter(infoHash)

		let self = this

		async.each( nodes, (node, callback) => { self._getNode(node).getPeers(infoHash).then( x => { self.emit("got_peers", x[0].map( peer => { return { ip : peer.host, port : peer.port }})); callback() } ) }, (err) => {

			nodes.forEach(node => { self._getNode(node).announcePeer(infoHash, port) } )

		} )
		
		return peers.map( peer => { return {ip : peer.host, port : peer.port} } )

	}

	async findNodeIter(nodeID) {

		return new Promise( (resolve, reject) => {

			let [[node], nodes] = this.findNode(nodeID)
			let allNodes = new NSet(nodes), queriedNodes = new NSet()
			let kClosest = nodes, kClosestCount = 0
			let pQueue
			let map = this.nodes
			let myNodeID = this.myNodeID

			var buildQueries = (node) => {

				let closestSoFar = Array.from(allNodes).sort(xorCompare(nodeID)).slice(0, 8)
				if( (new NSet(kClosest)).intersection(new NSet(closestSoFar)).size == 8 )
					kClosestCount++
				else 
					kClosestCount = 0
				
				kClosest = closestSoFar
				
				if(LOG) {
					console.log("nodeID:", nodeID, kClosestCount)
					console.log("kClosest:", kClosest.map( x => x.slice(0, 6) ) )
				}

				if(kClosestCount >= 8)
					return true

				let nextNodes = Array.from(allNodes.difference(queriedNodes)).sort(xorCompare(nodeID))
				if(nextNodes.length == 0 && pQueue.idle())
					return true

				nextNodes.slice(0,1).forEach(id => { pQueue.push( { id: id , times : 0 }, xorDistance(nodeID)(id) ) } )

				return false

			}

			var query = async (task, callback) => {

				if(queriedNodes.has(task.id)) 
					return callback()

				if(map.get(task.id).state == NODE_STATE.BAD || task.times >= 3) {
					queriedNodes.add(task.id)
					return callback()
				} 
	
				queriedNodes.add(task.id)

				if(LOG)
					console.log("query:", task.id)

				try {

					let [[node], result] = await map.get(task.id).findNode(nodeID)
					result = result.filter( id => id != myNodeID || map.has(id) && map.get(id).state != NODE_STATE.BAD )
					allNodes = allNodes.union(new NSet(result))

					if(buildQueries(node)) {
						resolve([node, kClosest]) //called only once
						pQueue.kill()
					}

				} catch (error) { 

					if( error instanceof TimeoutError)
						pQueue.push( { id: task.id , times : task.times+1} , xorDistance(nodeID)(task.id))

				} finally {

					callback()

				}

			}

			pQueue = async.priorityQueue(query, 8)

			allNodes.forEach( id => pQueue.push( { id: id, times : 0 } , xorDistance(nodeID)(id)) )

		})

	}

	async getPeersIter(nodeID, ignorePeers) {

		return new Promise( (resolve, reject) => {

			let startTime = Date.now()
			let [peers, nodes] = this.getPeers(nodeID)
			let allNodes = new NSet(nodes), queriedNodes = new NSet(), kClosest = nodes, kClosestCount = 0
			let pQueue, map = this.nodes, myNodeID = this.myNodeID
			let allPeers = peers ? peers : []

			var buildQueries = (peers) => {

				let closestSoFar = Array.from(allNodes).sort(xorCompare(nodeID)).slice(0, 8)
				if( (new NSet(kClosest)).intersection(new NSet(closestSoFar)).size == 8 )
					kClosestCount++
				else 
					kClosestCount = 0
				
				kClosest = closestSoFar
				
				if(LOG) {
					console.log("nodeID:", nodeID.slice(0,10), kClosestCount , "kClosest:", kClosest.map( x => x.slice(0, 8) ).join(" | "))
				}

				if(peers) {

					if(ignorePeers)
						peers.forEach( peer => {
							if(!ignorePeers.some( p => p.host == peer.host && p.port == peer.port)) 
								allPeers.push(peer)
						})
					else 
						allPeers = Array.from(new NSet(allPeers.concat(peers))) //no need for set - peer objects are not unique

				}

				if((Date.now() - startTime) > 30 * 1e3  || kClosestCount > 15 || kClosestCount >= 8 && allPeers.length > 0 
					|| allPeers.length > 50 || allNodes.difference(queriedNodes).size == 0 && pQueue.idle())
					return true

				let nextNodes = Array.from(allNodes.difference(queriedNodes)).sort(xorCompare(nodeID))
				nextNodes.forEach( id => queriedNodes.add(id) )
				nextNodes.forEach(id => { pQueue.push( { id: id , times : 0 }, xorDistance(nodeID)(id) ) } )

				return false

			}

			var query = async (task, callback) => {

				if(map.get(task.id).state == NODE_STATE.BAD || task.times >= 3) {
					callback()
					return
				}
				
				if(LOG)
					console.log('query:', task.id)

				try {

					let [peers, result] = await map.get(task.id).getPeers(nodeID)
					result = result.filter( id => map.get(id).state != NODE_STATE.BAD || id != myNodeID)
					allNodes = allNodes.union(new NSet(result))

					if(buildQueries(peers)) {
						resolve([allPeers, kClosest]) //called only once
						pQueue.kill()
						callback()
						return
					}

				} catch (error) { 

					if( error instanceof TimeoutError)
						pQueue.push( { id: task.id , times : task.times+1} , xorDistance(nodeID)(task.id))

				}

				callback()

			}

			pQueue = async.priorityQueue(query, 8)
			allNodes.forEach( id => queriedNodes.add(id) )
			allNodes.forEach( id => pQueue.push( { id: id, times : 0 } , xorDistance(nodeID)(id)) )

		})

	}
 	
	getPeers(infoHash) {

		let [node, nodes, hasMyNode] = this._getClosestNodes(infoHash)
		let peers
		if(hasMyNode)
			peers = this.infoHashes[infoHash]
		return [peers, nodes]

	}
 	
	findNode(nodeID) { 

		let [node, nodes, hasMyNode] = this._getClosestNodes(nodeID)
		return [[node], nodes]

	}

	_getClosestNodes(id) { 

		let nodeIDs = flatten(this.buckets.map(bucket => bucket.getBucketNodeIDs()))
		
		nodeIDs.sort(xorCompare(id)).filter(id => this._getNode(id).state != NODE_STATE.BAD )
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

	_getNode(nodeID) {

		return this.nodes.get(nodeID)

	}

	_insertNodeInDHT(nodeID) { //only called by makeNode 

		let node = this._getNode(nodeID)
		let bucket = this._findBucketFits(nodeID)

		if( bucket.contains(nodeID))
			return

		if( bucket.isFull() && bucket.nodeIDs.every( id => this._getNode(id).state == NODE_STATE.GOOD ))
			return

		else if(!bucket.isFull())
			bucket.insert(nodeID)

	 	else if(bucket.has(this.myNodeID)) {
			
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

		} else {  //bucket doesn't have myNode, is full but some node isn't good

			if(bucket.queue == null) {
				
				let map = this.nodes
				bucket.queue = async.queue(async function(task, callback) {

					let node = task.node, bucket = task.bucket
					if( bucket.isFull() && bucket.nodeIDs.every( id => map.get(id).state == NODE_STATE.GOOD ) 
						|| node.state == NODE_STATE.BAD) {
						callback()
						return
					}

					let quesNodeIDs = bucket.getBucketNodeIDs().filter( (id) => map.get(id).state != NODE_STATE.GOOD)
					quesNodeIDs.sort( (id1, id2 ) => map.get(id1).lastRespReq - map.get(id2).lastRespReq )
					let aQuesNodeID = quesNodeIDs.shift()

					while( quesNodeIDs.length > 0 ) {

						try {

							let ms = await map.get(aQuesNodeID).ping()
							if(LOG) 
								console.log("Pinged:", aQuesNodeID, "| rtt:", ms )
							
						} catch (error) {

							//if(error instanceof TimeoutError || error instanceof KRPCError || true) {
							bucket.remove(aQuesNodeID)
							bucket.insert(nodeID)
							break

						}

						aQuesNodeID = quesNodeIDs.shift()	

					}

					callback()

				}, 1) 
				
				bucket.queue.push( { node : node, bucket : bucket } )

			} else {
				
				bucket.queue.push( { node : node, bucket : bucket } )
			}
		}
		
	}
	_inDHT(id) {

		return this._findBucketFits(id).has(id)

	}

	_findBucketFits(id) {

		return this.buckets.find((bucket) => bucket.fits(id)) //always returns a bucket

	}

	_recvRequest(msg, rinfo) {

		if(!this.myNodeID)
			return

		let request

		try {

			request = benDecode(msg) // return 203 if malformed

		} catch (error) {

			return

		}

		let response
				
		if(request.y == 'q') {

			let queryNodeID = request.a.id.toString('hex')

			let node = this._getNode(this.makeNode(queryNodeID, rinfo.port, rinfo.address)) //if id in dht returns existing node
			node.resetQueryTimer()

			if(LOG)
				console.log(request)

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
					response = this._respAnnounce(request, rinfo.port, rinfo.address)
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
		let contactInfos

		if(nodeID != request.a.id && this._getNode(nodeID)) //if node querying itself, return list of nodes
			contactInfos = [this._getNode(nodeID).getContactInfo()]
		else if(nodeIDs)
			contactInfos = nodeIDs.map( id => this._getNode(id).getContactInfo() ) //.join("")

		return {'t': request.t, 'y':'r', 'r': {'id' : new Buffer(this.myNodeID, 'hex'), 'nodes': contactInfos}}

	}

	_respGetPeers(request) {

		let [peers, nodeIDs] = this.getPeers(request.a.info_hash.toString('hex')) //ignore node
		let response = {'t': request.t, 'y':'r', 'r' : {'id' : new Buffer(this.myNodeID, 'hex'), 'token': this.getToken(this.host) }}
		
		if(peers)
			response.r.values = peers.map(peer => peer.getContactInfoBuffer())

		response.r.nodes = nodeIDs.map( id => this._getNode(id).getContactInfo()).join("") 

		return response

	}

	_respAnnounce(request, impliedPort, host) {

		let token = request.a.token

		if(!this.isTokenValid(token, host))
			return {'t': request.t, 'y': 'e', 'e': [203, "Bad Token"]} 

		let port = request.a.implied_port != 0 ? impliedPort : request.a.port

		this.infoHashes[request.a.info_hash.toString('hex')].push(new Peer(port, this.host, request.a.id))

		return {'t': request.t, 'y':'r', 'r' : {'id': new Buffer(this.myNodeID, 'hex')}}	

	}

	parseNodeContactInfos(compactInfos) {

		var slicer = (buf) => {

			let slices = []

			while(buf.length > 0) {

				slices.push(buf.slice(0,26))
				buf = buf.slice(26)

			}

			return slices

		}

		var _makeNode = (info => {

			let parsedHost = info.slice(20,24).toString('hex').match(/.{2}/g).map( num => Number('0x'+num)).join('.') //: host.toString().match(/.{2}/g).map( num => Number(num)).join('.')
			let parsedPort = info.slice(24,26).readUInt16BE()

			return this.makeNode(info.slice(0,20).toString('hex'), parsedPort, parsedHost)
		
		}).bind(this)

		return slicer(compactInfos).map(_makeNode)

	}

}

class Bucket {

	constructor(min, max) {

		this.min = min
		this.max = max
		this.nodeIDs = []
		this.lastInsertTime = null
		this.worker = 0
		this.queue = null

	}

	get lastChanged() {

		return this.lastInsertTime
	
	}

	fits(id) { //nodeID or infoHash

		let num = parseInt('0x' + id)
		return num >= this.min && num < this.max 

	}

	contains(nodeID) {

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

		let pos = this.nodeIDs.findIndex( id => id == nodeID )
		if(pos != -1)
			this.nodeIDs.splice(pos, 1)

	}

	has(nodeID) {

		return this.nodeIDs.includes( nodeID )

	}

	getBucketNodeIDs() { //deepcopy

		return Object.assign([], this.nodeIDs) //new list of references

	}

	split() { 

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

	constructor(nodeID, port, host, myNodeID, sock, parseNodeContactInfos) {

		this.nodeID = nodeID
		this.port = port
		this.host = host
		this.myNodeID = myNodeID
		this.sock = sock
		this.default_timeout = 2000
		this.everResp = false // ever
		this.resp15min = false //15 mins
		this.query15min = false //15 mins
		this.lastQueryTime = 0
		this.lastRespTime = 0
		this.respTimer
		this.queryTimer
		this.numNoResp = 0
		this.parseNodeContactInfos = parseNodeContactInfos
	
	}

	get good() {

		return this.resp15min || (this.everResp && this.query15min)

	}

	get lastRespReq() {

		return Math.max(this.lastQueryTime, this.lastRespTime)

	}

/*	parsePeerContactInfos(compactInfos, nodeID) {

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

	}*/

	get state() {

		if(this.numNoResp >= 3) 
			return NODE_STATE.BAD

		if(this.good) 
			return NODE_STATE.GOOD 
		
		return NODE_STATE.QUES

	}

	update(port, host) {

		this.port = port
		this.host = host
		return this

	}

	resetQueryTimer() {

		let self = this
		clearTimeout(self.queryTimer)
		this.lastQueryTime = Date.now()
		this.query15min = true
		this.queryTimer = setTimeout(()=>{self.query15min = false}, 15 * 60 * 1e3)

	}

	resetRespTimer() {

		let self = this
		clearTimeout(self.respTimer)
		this.everResp = true
		this.resp15min = true
		this.lastRespTime = Date.now()
		this.respTimer = setTimeout(() => {self.resp15min = false}, 15 * 60 * 1e3)

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
			this.numNoResp = 0
			return Date.now() - then

		} catch(error) {

			if(error instanceof TimeoutError)
				this.numNoResp++

			throw error
		} 
	}

	async findNode(tar_getNodeID) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y' : 'q', 'q' : 'find_node', 'a' : {'id': Buffer.from(this.myNodeID,'hex'), 'target': Buffer.from(tar_getNodeID,'hex')}}

		let response

		try {

			response = await this._sendRequest(request)
			this.numNoResp = 0
			let nodes

			if(response.r && response.r.nodes)
				nodes = this.parseNodeContactInfos(response.r.nodes) //returns list not pair

			if(this.nodeID == tar_getNodeID)
				return [[targetnode], nodes]
			else
				return [[undefined], nodes] 

		} catch (error) {

			if(error instanceof TimeoutError)
				this.numNoResp++

			throw error

		}

	}

	async getPeers(infoHash) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'get_peers', 'a' : {'id': Buffer.from(this.myNodeID,'hex'), 'info_hash' : Buffer.from(infoHash, 'hex')}}
		let response
		
		try {
			
			response = await this._sendRequest(request)
			this.numNoResp = 0
			this.token = response.r.token
			let peers, nodes
		
			if(response.r && response.r.nodes)
				nodes = this.parseNodeContactInfos(response.r.nodes)

			if(response.r.values)
				peers = parsePeerContactInfos(response.r.values, response.r.id)

			return [ peers, nodes ]

		} catch( error ) {

			if(error instanceof TimeoutError) 
				this.numNoResp++
			
			throw error

		}

	}

	async announcePeer(infoHash, port) {

		let transactID = crypto.randomBytes(2)
		let request = {'t': transactID, 'y':'q', 'q': 'announce_peer', 'a' : {'id': Buffer.from(this.myNodeID,'hex'), 'implied_port': 1,
		'info_hash': infoHash, 'port': port, 'token': this.token}}
		let response

		try {
			
			response = await this._sendRequest(request)
			return response.r.id

		} catch ( error ) {

			if(error instanceof TimeoutError)
				this.numNoResp++

			throw error

		}

		return false		

	}

	//send request, setup listener to recieve response and resolve promise, return promise
	_sendRequest(request) {

		return new Promise( (resolve, reject) => {

			let self = this

			let timeout = setTimeout( ()=> {

				self.sock.removeListener('message', listener)
				reject(new TimeoutError("Timeout: " + self.default_timeout + " (ms)"))

			} , this.default_timeout)

			let listener = (msg, rinfo) => {
				
				let response

				try {
					
					response = benDecode(msg)

				} catch (error) {

					if(LOG)
						console.log(error)

					return //reject(error)

				}

 				if(response.t && response.t.equals(request.t)) { //buffers

					clearTimeout(timeout)
					self.sock.removeListener('message', listener)

					if(response.y && response.y.toString() == 'r') {

						self.resetRespTimer()
						resolve(response)

					} else if(response.y && response.y.toString() == 'e') {

						if(response.e && Array.isArray(response.e) && response.e.length >= 2)
							reject(new KRPCError(response.e[0] + ": "+ response.e[1]))
						else 
							reject(new KRPCError("???"))

					} else 
						reject(new KRPCError("??"))

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