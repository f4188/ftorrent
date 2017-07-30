
function WindowBuffer (startSeq, maxWindowBytes, maxRecvWindowBytes, packetSize) {
	this.buffer = []
	//this.unsendBuffer = []
	this.seqs = []
	this.bytes = 0
	//this.seqNum = 0
	this.seq = 0
	this.seqSeq 
	this.maxWindowBytes = maxWindowBytes;
	this.maxRecvWindowBytes = maxRecvWindowBytes
	this.packetSize = packetSize
	this.packetCapacity = Math.pow(2, 16)
	this.maxSeq = Math.pow(2, 16)
	this.turnOver = 0
	

	if(startSeq) {
		//this.insert(startSeq - 1, Buffer.alloc(0))
		this.buffer.push( {'seq': (startSeq), 'elem': Buffer.alloc(0) })
		this.seqSeq = startSeq + 1
		this.seq = 1
		//this.seqNum = startSeq + 1
	}
}

WindowBuffer.prototype.changeWindowSize = function(newWindowSize) {
	var i = 1;
	let bytes = 0
	//console.log(this.buffer)
	for(; i < this.buffer.length; i++) {
		bytes += this.buffer[i].elem.length
		if(bytes + this.buffer[i].elem.length >= newWindowSize) 
			break	
	}
	this.bytes = bytes;
	//let unsendBuffer = this.buffer.slice(i)
	//this.buffer = this.buffer.slice(0, i)
	this.maxWindowBytes = newWindowSize
	//this.seqSeq = this.buffer[i].seq
	this.seq = i
	//return unsendBuffer
}

WindowBuffer.prototype.getNext = function () {
	//if(this.seq == this.b) {}
		
	let next = this.buffer[this.seq]
	this.seq ++
	return next
}

WindowBuffer.prototype.hasNext = function () {
	return this.seq < this.buffer.length
}


WindowBuffer.prototype.windowWidth = function() {
	return this.endSeq() - this.startSeq() + 1 
}

WindowBuffer.prototype.curWindow = function () {
	//return this.bytes //- this.buffer.splice(this.buffer.length )
	return this.buffer.slice(1, this.seq).map(x=>{return x.elem.length}).reduce((x,y)=>{return x + y},0)

}

WindowBuffer.prototype.curBuffer = function() {
	return this.buffer.slice(1).map(x=>{return x.elem.length}).reduce((x,y)=>{return x + y},0)
}

WindowBuffer.prototype.startSeq = function() {
	return this.buffer[0].seq + 1
}

//WindowBuffer.prototype.endSeq = function() {
//	return this.buffer[this.seq].seq 
//}

WindowBuffer.prototype.seqNum = function() { 
	//if(this.seq == this.buffer.length) return  
	//return this.buffer[this.seq].seq % this.maxSeq
	return (this.buffer[this.seq - 1].seq + 1) % this.maxSeq
}

WindowBuffer.prototype.ackNum = function() {
	//console.log(this.buffer)
	return this.buffer[0].seq % this.maxSeq
}

WindowBuffer.prototype.numPackets = function() {
	return this.buffer.length - this.chopOff - 1
}

/*
WindowBuffer.prototype.curWindow = function() {
	return this.maxWindowBytes - 
}*/


WindowBuffer.prototype.isEmpty = function() {
	//assert(this.numPackets != this.buffer.length, "numPackets != buffer.length")
	return this.buffer.length == 1
}

WindowBuffer.prototype.isWindowFull = function() {
	return (this.maxWindowBytes == -1 || (this.curWindow() > (this.maxWindowBytes - this.packetSize)) ) 
		&&  ((this.curWindow() > (this.maxRecvWindowBytes - this.packetSize) ) )
}

WindowBuffer.prototype.isBufferFull = function() {
	return (this.maxWindowBytes == -1 || (this.curBuffer() > (this.maxWindowBytes - this.packetSize)) ) 
		&&  ((this.curBuffer()  > (this.maxRecvWindowBytes - this.packetSize) ) )
}


WindowBuffer.prototype.insert = function(seq, elem) {
	//if(buffer[0].seq == this.maxSeq) this.over = false
	//if(this.seq == null) this.seq = seq
	if(seq && seq == this.maxSeq) this.turnOver += 1
		//this.over = true;
	
	//console.log(seq)

	if(seq == null) 
		seq = this.buffer[this.buffer.length - 1].seq + 1
	else 
		seq += this.maxSeq * this.turnOver
	//console.log(seq)
	this.bytes += elem.length

	this.seqs.push(seq)
	
	//before beginning - should never happen
	if(seq <= this.buffer[0].seq) {
		this.buffer.splice(1, 0, {'seq': seq, "elem":elem})
		this.buffer[0].seq = seq - 1
	}
	var i = 1
	for(; i < this.buffer.length; i++) {
		if(this.buffer[i].seq == seq) {
			this.buffer.splice(i, 1, {'seq':seq, "elem": elem})
			return 
		} else if(this.buffer[i].seq > seq) {
			this.buffer.splice(i, 0, {'seq':seq, 'elem': elem})
			return
		}
	}
	//if(seq > this)

	this.buffer.push({'seq':seq, 'elem':elem}) //last element
	//this.seq = this.buffer.length - 1
	return seq % this.maxSeq
}

WindowBuffer.prototype.get = function(seq) {
	for(var i = 1; i < this.buffer.length; i++) {
		if(this.buffer[i].seq == seq)
			return this.buffer[i].elem
	}
	return undefined
}

WindowBuffer.prototype.remove = function(seq) {
	for(var i = 1; i < this.buffer.length; i++) {
		if(this.buffer[i].seq == seq) {
			if(i == 1) {
				this.buffer[0].seq += 1
			}
			this.bytes -= this.buffer.splice(i, 1).elem.length
			return true
		}
	}
	return false
		
}

WindowBuffer.prototype.removeUpto = function(upto) {
	let turnOver = this.turnOver
	if(upto >= this.buffer[0].seq % this.maxSeq && upto < this.maxSeq) turnOver -= 1
	upto += this.maxSeq * this.turnOver
	

	if(upto == this.buffer[0].seq) return [] //dupAck

	var i = 1
	for(; i < this.buffer.length; i++) {
		if(this.buffer[i].seq == upto) 
			break
	}

	let elems = this.buffer.splice(1, i)
	this.buffer[0].seq = upto
	if(i >= this.seq)
		this.seq = 1
	else 
		this.seq -= i


	//if(elems)
	//	console.log("removed elems from", elems[0].seq)
	//if(elems.length > 1)
	//	console.log("to", elems[1].seq)
	//return elems
	//if(upto > max) 
	//	return upto - max
	//else return 0

}

//remove elements with contiguous sequence numbers from beginning to upto or until missing elem
WindowBuffer.prototype.removeSequential = function(upto) {
	//if(this.turnOver > 0)
	//if(upto )
	//console.log("BEFORE",this.buffer.map(x=>{return x.seq}))
	let turnOver = this.turnOver
	if(upto >= this.buffer[0].seq % this.maxSeq && upto < this.maxSeq) turnOver -= 1
	upto += this.maxSeq * this.turnOver
	

	var i = 1
	if(upto != undefined && upto <= this.ackNum()) return []
	
	for(; i < this.buffer.length; i++) {
		let nextSeq = this.buffer[i].seq 
		if( (!upto || nextSeq <= upto) 
			&& nextSeq == this.buffer[i-1].seq + 1) {
			
			this.bytes -= this.buffer[i].elem.length
		} else 
			break
	}
	//if(unsend)
	if(i == 1) return [] // empty or no sequential seqs

	this.buffer[0].seq = this.buffer[i-1].seq
	let elems = this.buffer.splice(1, i - 1)
	//console.log("removed from", elems[0].seq)
	//if(elems.length > 1)
	//	console.log("from", elems[elems.length-1].seq)
	//console.log("AFTER",this.buffer.map(x=>{return x.seq}))
	return elems.map(x=>x.elem)

}



module.exports = WindowBuffer