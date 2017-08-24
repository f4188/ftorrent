
class Intervals {

	constructor(left, right) {
		this.left = left
		this.right = right
		this.intervals = new Set()
	}

	add(left, right) {
		this.intervals.add(left+","+right)
	}

	has(left, right) {
		this.Intervals.has(left+","+right)
	}

	get complete() {
		let left = this.left
		let newLeft = left

		do {
			left = newLeft
			newLeft = Math.max(left, ...Array.from(this.intervals).filter( k => k.split(',')[0] <= left).map( k => k.split(',')[1]) )
		} while( left < this.right  && newLeft > left) 
	
		return left >= this.right
	}

}
