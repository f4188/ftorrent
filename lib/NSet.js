
class NSet extends Set {

	isSuperset(subset) {
	    for (var elem of subset) {
	        if (!this.has(elem)) {
	            return false;
	        }
	    }
	    return true;
	}

	union(setB) {
	    var union = new NSet(this);
	    for (var elem of setB) {
	        union.add(elem);
	    }
	    return union;
	}

	intersection(setB) {
	    var intersection = new NSet();
	    for (var elem of setB) {
	        if (this.has(elem)) {
	            intersection.add(elem);
	        }
	    }
	    return intersection;
	}

	difference(setB) {
	    var difference = new NSet(this);
	    for (var elem of setB) {
	        difference.delete(elem);
	    }
	    return difference;
	}

}


class NMap extends Map {

	filter(func) {

		let ret = new NMap()

		for (var [key, value] of this) {
			if(func(value))
				ret.set(key, value)
		}

		return ret

	}

	getArray() {

		return Array.from(this.values())

	}

 	getArrOf(keys) {

 		let ret = []
 		for(var key of keys) {
 			ret.push(this.get(key))
 		}

 		return ret

 	}

 	
 	getSet() {

 		return new NSet(this.keys())

 	}

}



module.exports = {

	NSet : NSet,
	NMap : NMap
	
}


