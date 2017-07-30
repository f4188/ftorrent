function TQueue() {
	this.queue = []
}



TQueue.prototype.insert = function(time, elem) {
	for(var i = 0; i < this.queue.length; i++) {
		if(time < this.queue[i].time) {
			this.queue.splice(i, 0, {'time': time, 'elem':elem})
			return this
		}
	}
	this.queue.push({'time': time, 'elem':elem})
	return this
}

TQueue.prototype.removeByElem = function(elem) {
	for(var i = 0; i < this.queue.length; i++) {
		if(elem == this.queue[i].elem)
			this.queue = this.queue.slice(i,1)
			return true
	}
	return false
}

TQueue.prototype.removeAfterElem = function(elem) {
	var i = 0
	new_queue = []
	for(; i < this.queue.length; i++) {
		if(this.queue[i].elem < elem)
			new_queue.push(this.queue[i])
			
	}
	//this.queue = this.queue.slice(i)

	this.queue = new_queue
	return i - new_queue.length
}

TQueue.prototype.removeUptoElem = function(elem) {
	var i = 0
	new_queue = []
	for(; i < this.queue.length; i++) {
		if(this.queue[i].elem > elem)
			new_queue.push(this.queue[i])
			
	}
	//this.queue = this.queue.slice(i)

	this.queue = new_queue
	return i - new_queue.length
}

TQueue.prototype.popMinTime = function() {
	return this.queue.shift()
}

TQueue.prototype.peekMinTime = function() {
	return this.queue[0]
}

TQueue.prototype.empty = function() {
	this.queue = []
	return this
}

TQueue.prototype.isEmpty =  function() {
	return this.queue.length == 0
}

module.exports = TQueue