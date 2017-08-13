function Heap() 
{	
	this.array = []
}

Heap.prototype.insert = function(value, elem) {
	for(var i = 0; i < this.array.length; i++) {
		if(value < this.array[i].value) {
			this.array.splice(i, 0, {'value': value, 'elem':elem})
			return this
		}
	}
	this.array.push({'value': value, 'elem':elem})
	return this
}

Heap.prototype.removeElemEqual = function(elem) {
	for(var i = 0; i < this.array.length; i++) {
		if(elem == this.array[i].elem)
			this.array = this.array.slice(i,1)
			//return true
	}
	//return false
}

Heap.prototype.removeElemGreater = function(elem) {
	var i = 0
	new_array = []
	for(; i < this.array.length; i++) {
		if(this.array[i].elem < elem)
			new_array.push(this.array[i])			
	}

	this.array = new_array
	return i - new_array.length
}

Heap.prototype.removeElemLess = function(elem) {
	var i = 0
	new_array = []
	for(; i < this.array.length; i++) {
		if(this.array[i].elem > elem)
			new_array.push(this.array[i])
			
	}

	this.array = new_array
	return i - new_array.length
}

Heap.prototype.popMinValue = function() {
	return this.array.shift()
}

Heap.prototype.peekMinValue = function() {
	return this.array[0].value
}

Heap.prototype.empty = function() {
	this.array = []
	return this
}

Heap.prototype.isEmpty =  function() {
	return this.array.length == 0
}

module.exports = Heap