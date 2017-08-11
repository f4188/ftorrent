
class WindowBuffer {

	constructor(startSeq, maxWindowBytes, maxRecvWindowBytes, packetSize) {
		this.buffer = []
		this.maxWindowBytes = maxWindowBytes || 1500
		this.maxRecvWindowBytes = maxRecvWindowBytes || 100000
		this.packetSize = packetSize || 500
		this.maxSeq = Math.pow(2, 16)
		this.turnOver = 0
		this.buffer.push( {'seq': (startSeq), 'elem': Buffer.alloc(0) })
		
		this.seq = 1	
	}

	windowWidth() {
		return this.endSeq() - this.startSeq() + 1 
	}

	curWindow() {
		return this.buffer.slice(1, this.seq).map(x=>{return x.elem.length}).reduce((x,y)=>{return x + y},0)
	}

	startSeq() {
		return this.buffer[0].seq + 1
	}

	seqNum() { 
		return (this.buffer[this.seq - 1].seq + 1) % this.maxSeq
	}

	ackNum() {
		return this.buffer[0].seq % this.maxSeq
	}

	isEmpty() {
		return this.buffer.length == 1
	}

	isWindowFull() {
		return (this.maxWindowBytes == -1 || (this.curWindow() > (this.maxWindowBytes - this.packetSize)) ) 
			||  ((this.curWindow() > (this.maxRecvWindowBytes - this.packetSize) ) )
	}

	insert(seq, elem) {	
		if(seq == null) 
			seq = this.buffer[this.buffer.length - 1].seq + 1
		else if (seq > this.ackNum()) 
			seq += this.maxSeq * this.turnOver
		else 
			seq += this.maxSeq * (this.turnOver + 1)
		
		//before beginning - should never happen
		if(seq <= this.buffer[0].seq) {
			this.buffer.splice(1, 0, {'seq': seq, "elem":elem})
			this.buffer[0].seq = seq - 1
		}
		var i = 1
		for(; i < this.buffer.length; i++) {
			if(this.buffer[i].seq == seq) {
				this.buffer.splice(i, 1, {'seq':seq, "elem": elem}) //overwrite
				return 
			} else if(this.buffer[i].seq > seq) {
				this.buffer.splice(i, 0, {'seq':seq, 'elem': elem})
				return
			}
		}

		this.buffer.push({'seq':seq, 'elem':elem}) //last element
		return seq % this.maxSeq
	}

	getPack(seq) {
		for(var i = 1; i < this.buffer.length; i++) {
			if(this.buffer[i].seq == seq)	
				return this.buffer[i]
		}
		return undefined
	}

	get(seq) {
		for(var i = 1; i < this.buffer.length; i++) {
			if(this.buffer[i].seq == seq)
				return this.buffer[i].elem
		}
		return undefined
	}


	remove(seq) {
		for(var i = 1; i < this.buffer.length; i++) {
			if(this.buffer[i].seq == seq) {
				if(i == 1) 
					this.buffer[0].seq += 1
				return true
			}
		}
		return false
	}
		
}

class SendBuffer extends WindowBuffer {

 	curBuffer() {
 		return this.buffer.slice(1).map(x=>{return x.elem.length}).reduce((x,y)=>{return x + y},0)
	}

	isBufferFull() {
		return (this.maxWindowBytes == -1 || (this.curBuffer() > (this.maxWindowBytes - this.packetSize)) ) 
		||  ((this.curBuffer()  > (this.maxRecvWindowBytes - this.packetSize) ) )
	}	

	removeUpto(upto) {	
		if(upto < this.ackNum()) {
			this.turnOver ++
			upto += this.maxSeq * this.turnOver
		} else 
			upto += this.maxSeq * this.turnOver

		if(upto == this.buffer[0].seq) 
			return [] //dupAck

		var i = 1
		for(; i < this.buffer.length; i++) {
			if(this.buffer[i].seq == upto) 
				break
		}

		let elems = this.buffer.splice(1, i)
		elems.forEach((x)=>clearTimeout(x.timer))
		let ret = elems.map((x)=>{return x.timeStamp})

		this.buffer[0].seq = upto
		if(i >= this.seq)
			this.seq = 1
		else 
			this.seq -= i
		return ret
	}

	changeWindowSize(newWindowSize, dump) {
		var i = 1;
		let bytes = 0


		for(; i < this.buffer.length; i++) {
			bytes += this.buffer[i].elem.length
			if(bytes >= newWindowSize)  
				break	
		}

		this.maxWindowBytes = newWindowSize
		this.seq = i
		//let self = this
		for(var j = i; j < this.buffer.length; j++) {
			if(this.buffer[j].timer) 
				let pack = this.buffer[j]
				clearTimeout(pack.timer)
		}

		if(i != this.buffer.length)
			return this.buffer[i].seq


	}

	getNext() {
		let next = this.buffer[this.seq]
		this.seq ++
		return next
	}

	hasNext() {
		return this.seq < this.buffer.length
	}
}

//remove elements with contiguous sequence numbers from beginning to upto or until missing elem
class RecvWindow extends WindowBuffer {
	removeSequential(upto) {
		let turningOver = false
		if(upto < this.ackNum()) {
			this.turnOver ++
			turningOver = true
			upto += this.maxSeq * this.turnOver
		} else upto += this.maxSeq * this.turnOver

		var i = 1
		if(upto != undefined && upto <= this.ackNum()) return []
	
		for(; i < this.buffer.length; i++) {
			let nextSeq = this.buffer[i].seq 
			if( (!upto || nextSeq <= upto) 
				&& nextSeq == this.buffer[i-1].seq + 1) {
			//this.bytes -= this.buffer[i].elem.length
			} else 
				break
		}

		if(i == 1) return [] // empty or no sequential seqs

		this.buffer[0].seq = this.buffer[i-1].seq
		let elems = this.buffer.splice(1, i - 1)

		if(this.ackNum() < this.maxSeq && turningOver) this.turnOver -- ;

		return elems.map(x=>x.elem)

	}
}

module.exports.SendBuffer = SendBuffer
module.exports.RecvWindow = RecvWindow