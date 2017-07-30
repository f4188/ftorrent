
function WindowBuffer (startSeq, maxWindowBytes, maxRecvWindowBytes, packetSize) {
	this.buffer = []
	//this.unsendBuffer = []
	this.seqs = []
	this.bytes = 0
	//this.seqNum = 0
	this.maxWindowBytes = maxWindowBytes;
	this.maxRecvWindowBytes = maxRecvWindowBytes
	this.packetSize = packetSize
	this.packetCapacity = Math.pow(2, 16)
	this.maxSeq = Math.pow(2, 16)
	this.turnOver = 0
	

	if(startSeq) {
		//this.insert(startSeq - 1, Buffer.alloc(0))
		this.buffer.push( {'seq': (startSeq), 'elem': Buffer.alloc(0) })
		//this.seqNum = startSeq + 1
	}
}

WindowBuffer.prototype.changeWindowSize = function(newWindowSize) {
	var i = 1;
	let bytes = 0
	//console.log(this.buffer)
	for(; i < this.buffer.length; i++) {
		bytes += this.buffer[i].elem.length
		if(bytes + this.buffer[i].elem.length > newWindowSize) 
			break	
	}
	this.bytes = bytes;
	let unsendBuffer = this.buffer.slice(i)
	this.buffer = this.buffer.slice(0, i)
	this.maxWindowBytes = newWindowSize

	return unsendBuffer
}


WindowBuffer.prototype.windowWidth = function() {
	return this.endSeq() - this.startSeq() + 1 
}

WindowBuffer.prototype.curWindow = function () {
	return this.bytes //- this.buffer.splice(this.buffer.length )
}

WindowBuffer.prototype.startSeq = function() {
	return this.buffer[0].seq + 1
}

WindowBuffer.prototype.endSeq = function() {
	return this.buffer[this.buffer.length - 1].seq 
}

WindowBuffer.prototype.seqNum = function() {
	return (this.endSeq() + 1) % this.maxSeq
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

WindowBuffer.prototype.isFull = function() {
	return (this.maxWindowBytes == -1 || (this.curWindow() > (this.maxWindowBytes - this.packetSize)) ) 
		&&  ((this.curWindow() > (this.maxRecvWindowBytes - this.packetSize) ) )
}

WindowBuffer.prototype.insert = function(seq, elem) {
	//if(buffer[0].seq == this.maxSeq) this.over = false
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
	//console.log(this.buffer)
	if(seq <= this.buffer[0].seq) {
		this.buffer.splice(1, 0, {'seq': seq, "elem":elem})
		this.buffer[0].seq = seq - 1
	}

	for(var i = 1; i < this.buffer.length; i++) {
		if(this.buffer[i].seq == seq) {
			this.buffer.splice(i, 1, {'seq':seq, "elem": elem})
			return 
		} else if(this.buffer[i].seq > seq) {
			this.buffer.splice(i, 0, {'seq':seq, 'elem': elem})
			return
		}
	}
	this.buffer.push({'seq':seq, 'elem':elem})
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
	
	let max = this.buffer[this.buffer.length-1].seq

	if(upto == this.buffer[0].seq) return [] //dupAck

	var i = 1
	for(; i < this.buffer.length; i++) {
		if(this.buffer[i].seq == upto) 
			break
	}

	let elems = this.buffer.splice(1, i)
	this.buffer[0].seq = upto
	//return elems
	if(upto > max) 
		return upto - max
	else return 0

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
	let elems = this.buffer.splice(1, i - 1).map(x => x.elem)
	//console.log("AFTER",this.buffer.map(x=>{return x.seq}))
	return elems

}



module.exports = WindowBuffer