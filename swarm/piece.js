
/*
 * Pieces objects that read and write piecelets
 * A piece object with read and verify methods
 * An active piece object with isComplete, assemble, write methods
*/

const crypto = require('crypto')
const fs = require('graceful-fs')

var readStreamFunc = (start, len, file) => {

	return new Promise( (resolve, reject) => {

		file.read(start, len, function (err, buf) { 

			if(err)
				reject(err)
			else
				resolve(buf) 

		}) 

	})

}

var writeStreamFunc = (start, buf, file) => {
	
	return new Promise( (resolve, reject) => {

		file.write(start, buf, (err) => { 

			if(err) 
				reject(err) 
			else 
				resolve(true)

		})

	})

}

var Pieces = (file) => class Piece {

	constructor(index) {

		this.hash = file.pieceHashes[index]

		this.path = file.path
		this.pathList = file.pathList
		this.files = file.files
		this.fileLengthList = file.fileLengthList

		this.index = index 
		this.isLast = index == file.numPieces - 1
		this.normalPieceLength = file.pieceLength
		this.pieceLength = this.isLast ? file.fileLength % file.pieceLength : file.pieceLength

	} 

	async doPiecelet(begin, length, doFunc, buf) { //reads/writes (doFunc) arbitrary piecelet across multiple files

		let start = this.index * this.normalPieceLength + begin, end = start + length
		let chunks, leftBound = 0, fileBounds = []

		for(var i = 0 ; i <this.fileLengthList.length; i++) {

			let rightBound = leftBound + this.fileLengthList[i]

			if ( leftBound < start && rightBound > start || leftBound < end && rightBound > end )
				fileBounds.push([i, leftBound, rightBound])

			leftBound = rightBound

		}

		try {

			chunks = await Promise.all( fileBounds.map( async bound => {

				let leftFileOffset =  Math.max(start - bound[1], 0)
				let rightFileOffset = Math.min( end, bound[2] )
				
				let chunkletOrLen 
 					
 				if(buf) {

 					let leftPieceOffset = Math.max( bound[1] - start, 0) 
					let rightPieceOffset = Math.min( end - start, bound[2] - start )

 					chunkletOrLen = buf.slice( leftPieceOffset , rightPieceOffset)	

 				} else
					chunkletOrLen = Math.min( end - start, bound[2] - start ) - Math.max( bound[1] - start, 0)

				return await doFunc( leftFileOffset, chunkletOrLen, this.files[bound[0]]) //chunkletOrLen is either buffer or int

			
			}))

			return buf ?  true : Buffer.concat(chunks)

		} catch (error) {

			return false

		}	

	}

	async readPiece() {

		let begin = 0, length = this.pieceLength 
		return await this.readPiecelet(begin, length)

	}

	async readPiecelet(begin, length) { //reads arbitrary *valid piecelet

		return await this.doPiecelet(begin, length, readStreamFunc)

	}

	async verify() {

		let buf = await this.readPiece()

		if(!buf) 
			return this.good = false

		let hash = crypto.createHash('sha1').update(buf).digest('hex')
		return this.good = hash == this.hash

	}

}

var ActivePieces = (file) => class ActivePiece extends Pieces(file) {

	constructor(index) {

		super(index)

		//local to nextPiecelet ///////
		this.pieceletLength = 2 ** 14
		this.numPiecelets = Math.ceil(this.pieceLength / this.pieceletLength) 
		//////////////////////////

		this.piecelets = new Map() 
		this.requestList = new Map()
		this.dispatchList = new Map()

		this.left = 0
		this.right = this.left + this.pieceLength

		this.reqIter = null
		this.makeRequests()

	}

	* nextPiecelet() {

		let left = this.left, self = this

		while ( left < this.right ) {
			
			let length = (this.right - left) / this.pieceletLength > 1 ? this.pieceletLength : (this.right - left) 
			let request = { index : this.index, begin : left, length : length, dispatched : 0}
			yield request
			left += this.pieceletLength

		}

		return false

	}

	makeRequests() {

		var gen = this.nextPiecelet()
		var next = gen.next()

		while(!next.done) {

			let req = next.value
			this.requestList.set(req.begin + "," + (req.begin + req.length), req)
			next = gen.next()


		}

	}

	async add(index, start, piecelet) {

		let left = start, right = left + piecelet.length		

		let request = this.requestList.get(left + "," + right)
		clearTimeout(request.timeout)

		try {

			await this.writePiecelet(left, piecelet.length, piecelet)
			this.piecelets.set(left + "," + right, 1)
			this.dispatchList.delete(left + "," + right)


		} catch (error) {
	
			this.dispatchList.delete(left + "," + right)

		}

	}

	//never used 
	has(index, start, length) {

		//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
		let left = this.index * this.pieceLength + start
		//let left = this.index * this.pieceletLength + start
		let right = left + length
		return this.piecelets.has(left + "," + right) 

	}

	get isComplete() {

		if(this.piecelets.size < this.requestList.size)
			return false

		let left = this.left
		let newLeft = left

		do {

			left = newLeft
			newLeft = Math.max(left, ...Array.from(this.piecelets.keys()).filter( k => k.split(',')[0] <= left).map( k => k.split(',')[1]) )

		} while( left < this.right && newLeft > left) 
	
		return left >= this.right

	}

	async assemble() { 

		if(!this.isComplete) return 

		let left = this.left
		let buf = Buffer.alloc(this.pieceLength)

		do {

			let lefts = Array.from(this.piecelets.keys()).filter( k => Number(k.split(',')[0]) <= left)
			let maxRight = Math.max( ...lefts.map( k =>  Number(k.split(',')[1]) ) )
			let interval = lefts.find( k => k.split(',')[1] == maxRight )

			let piecelet //= this.piecelets.get(interval)
			let [start, end] = interval.split(",").map(x => parseInt(x))
			let len = end - start
			piecelet = await this.readPiecelet(start, len)
			piecelet.copy(buf, Number(interval.split(',')[0]), 0, piecelet.length)

			left = maxRight

		} while( left < this.right ) 

		let hash = crypto.createHash('sha1').update(buf).digest('hex')

		if( hash == this.hash)
			return true
		
		this.dispatchList.clear()
		this.piecelets.clear()

		this.requestList.clear()
		this.makeRequests()
		return false

	}

	async writePiecelet(begin, length, buf) {

		return await this.doPiecelet(begin, length, writeStreamFunc, buf)

	}	

	async writePiece(buf) { //not used anywhere

		//let start = this.index * this.normalPieceLength
		//let end = start + this.pieceLength

		return await this.writePiecelet(0, buf.length, buf)

	}

	randPieceletReq(peer) {

		let self = this 
		let req
		/////////////////////////////////////////////////////////////////////////////////////////////////////////////
		
		//if(this.reqIter)
		//this.arr = this.requestList.values()
		let arr = Array.from(this.requestList.values()) //too slow

		//let req = this.arr.next()
		//if(this.dispatchList.has(req.begin + "," + (req.begin + req.length))) loop
		//this.dispatchList.set(req.begin + "," + (req.begin+ req.length), req)
		//reset arr if no more elems but missing piecelets

		for( var idx = 0 ; idx < arr.length; idx ++ ) {

			let reqKey = arr[idx].begin + "," + (arr[idx].begin + arr[idx].length)

			if( !this.dispatchList.has( reqKey ) && !this.piecelets.has( reqKey ) ) {
				req = arr[idx]
				this.dispatchList.set(req.begin + "," + (req.begin + req.length), req)
				break
			}

		}

		////////////////////////////////////////////////////////////////////////////////////////////////////////
		if(req) {

			var _putBack = () => this.dispatchList.delete(req.begin + "," + (req.begin + req.length))

			req.timeout = setTimeout( _putBack, 30 * 1e3)
			req.putBack = _putBack

		}

		return req

	}

	requestsLeft() {

		return this.requestList.size - this.dispatchList.size - this.piecelets.size

	}	 

}

module.exports = {
	'Pieces' : Pieces,
	'ActivePieces' : ActivePieces
}

