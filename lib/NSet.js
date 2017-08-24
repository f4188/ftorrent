
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


module.exports = {

	NSet : NSet
	
}


