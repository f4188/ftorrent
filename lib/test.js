

var assert = require('assert')
var Window = require('./Window.js')
var sinon = require('sinon')
var expect = require('chai').expect

describe('Window', function() {

	

	describe('#insert', function(){
		//var window = new Window(99)
		beforeEach(function() {
			window = new Window(99)
		})

		it("should be empty with ackNum 99", function() {
			//window = new Window(99)
			expect(window.buffer).to.have.lengthOf(1)
			expect(window.buffer[0]).to.have.property('seq', 99)
			expect(window.buffer[0]).to.have.property('elem').that.is.instanceof(Buffer)
		})
		

		
		it("should insert {seq:100, elem:foo}", function() {
			//window = new Window(99)
			window.insert(100, new Buffer('foo'))
			expect(window.buffer).to.have.lengthOf(2)			
			expect(window.buffer[1]).to.have.property('seq', 100)
			assert(window.buffer[1].elem.equals(new Buffer('foo')))
				//expect(window.numPackets()).to.equal(2)
				//expect(window.windowWidth()).to.equal(2)
				//expect(window.ackNum()).to.equal(99)
				//expect(window.seqNum()).to.equal(101)
				//expect(window.curWindow().to.equal(3))
		})
		

		it("should insert {seq:100, elem:foo} then {seq:200, elem:bar} ", function() {
			//window = new Window(99)
			window.insert(100, new Buffer('foo'))
			window.insert(200, new Buffer('bar'))			
			expect(window.buffer).to.have.lengthOf(3)
			expect(window.buffer[2]).to.have.property('seq', 200)
			expect(window.buffer[2]).to.have.property('elem').that.is.instanceof(Buffer)
		})

		it('should insert {seq:200, elem:bar}, then {seq:100, elem:bar}', function () {
			window.insert(200, new Buffer('bar'))	
			window.insert(100, new Buffer('foo'))		
			expect(window.buffer).to.have.lengthOf(3)
			expect(window.buffer[1]).to.have.property('seq', 100)
			assert(window.buffer[1].elem.equals(new Buffer('foo')))
			expect(window.buffer[2]).to.have.property('seq', 200)
			expect(window.buffer[2]).to.have.property('elem').that.is.instanceof(Buffer)
		})

		it('should insert {seq:95, elem:foo}', function() {
			window.insert(95, new Buffer('foo'))
			//console.log(window.buffer[1].seq)
			expect(window.buffer).to.have.lengthOf(2)
			expect(window.buffer[1]).to.have.property('seq', 95)
			assert(window.buffer[1].elem.equals(new Buffer('foo')))
			expect(window.buffer[0]).to.have.property('seq',94)
		})

		it('should insert {seq:99, elem:foo}', function() {
			window.insert(99, new Buffer('foo'))
			//console.log(window.buffer[1].seq)
			expect(window.buffer).to.have.lengthOf(2)
			expect(window.buffer[1]).to.have.property('seq', 99)
			assert(window.buffer[1].elem.equals(new Buffer('foo')))
			expect(window.buffer[0]).to.have.property('seq',98)
		})

		it('should insert {seq:98, elem:foo} then {seq:98, elem:bar}', function() {
			window.insert(98, new Buffer('foo'))
			window.insert(98, new Buffer('bar') )
			//console.log(window.buffer[1].seq)
			expect(window.buffer).to.have.lengthOf(2)
			expect(window.buffer[1]).to.have.property('seq', 98)
			assert(window.buffer[1].elem.equals(new Buffer('bar')))
			expect(window.buffer[0]).to.have.property('seq',97)
		})

		it("should insert several {seq, elems} out of order", function() {
			//window = new Window(99)

			window.insert(100, new Buffer('foo'))
			window.insert(200, new Buffer('bar'))
			window.insert(130, new Buffer('foobar'))
			window.insert(170, new Buffer('barfoo'))
			window.insert(199, new Buffer('barbar'))
			window.insert(101, new Buffer('foofoo'))			
			expect(window.buffer).to.have.lengthOf(7)
			//100, 101, 130,, 170, 199, 200 
			//console.log(window)
			//expect(window.buffer).to.deep.equal()
			expect(window.buffer[1]).to.have.property('seq', 100)
			assert(window.buffer[1].elem.equals(new Buffer('foo')))
			expect(window.buffer[2]).to.have.property('seq', 101)
			assert(window.buffer[2].elem.equals(new Buffer('foofoo')))
			expect(window.buffer[3]).to.have.property('seq', 130)
			assert(window.buffer[3].elem.equals(new Buffer('foobar')))
			expect(window.buffer[4]).to.have.property('seq', 170)
			assert(window.buffer[4].elem.equals(new Buffer('barfoo')))
			expect(window.buffer[5]).to.have.property('seq', 199)
			assert(window.buffer[5].elem.equals(new Buffer('barbar')))
			expect(window.buffer[6]).to.have.property('seq', 200)
			assert(window.buffer[6].elem.equals(new Buffer('bar')))

		})
		
		
	})

	describe('#get', function() {
		beforeEach(function() {
			window = new Window(99)	
		})

		it("should return {seq,elem}", function() {
			//window = new Window(99)

			window.insert(100, new Buffer('foo'))
			window.insert(200, new Buffer('bar'))
			window.insert(130, new Buffer('foobar'))
			window.insert(170, new Buffer('barfoo'))
			window.insert(199, new Buffer('barbar'))
			window.insert(101, new Buffer('foofoo'))	
		})


	})

	describe('#remove', function() {


	})

	describe('#removeSequential', function() {
		beforeEach(function() {
			window = new Window(99)	
		})

		it("should do nothing on empty window", function() {
			expect(window.removeSequential()).to.have.lengthOf(0)
			expect(window.buffer).to.deep.equal([{'seq': 99, 'elem': Buffer.alloc(0)}])
		})
		
		it("remove everything and set ackNum", function() {
			window.insert(100, 'foo')
			window.insert(101, 'bar')
			window.insert(102, 'foobar')
			window.insert(103, 'barfoo')
			window.insert(104, 'barbar')
			window.insert(105, 'barbar')
			packs = window.removeSequential()	
			expect(window.buffer).to.have.lengthOf(1)
			expect(window.buffer[0]).to.have.property('seq', 105)
			expect(window.ackNum()).to.equal(105)
			expect(packs).to.have.lengthOf(6)
		})		

		it("should do nothing if no sequential seqs", function() {
			window.insert(101, 'foo')
			window.insert(200, 'bar')
			window.insert(130, 'foobar')
			window.insert(170, 'barfoo')
			window.insert(199, 'barbar')
			window.insert(103, 'barbar')
			window.removeSequential()	
			expect(window.buffer).to.deep.equals([{'seq': 99, 'elem': Buffer.alloc(0)}, {'seq': 101, 'elem':'foo'}, {'seq': 103, 'elem':'barbar'},
				{'seq': 130, 'elem':'foobar'}, {'seq': 170, 'elem':'barfoo'}, {'seq': 199, 'elem':'barbar'}, {'seq': 200, 'elem':'bar'}])
		})

		it("should remove {100, foo} and {101:foofoo}. AckNum should be 129", function() {
			//window = new Window(99)

			window.insert(100, new Buffer('foo'))
			window.insert(200, new Buffer('bar'))
			window.insert(130, new Buffer('foobar'))
			window.insert(170, new Buffer('barfoo'))
			window.insert(199, new Buffer('barbar'))
			window.insert(101, new Buffer('foofoo'))	
			
			let packs = window.removeSequential()
			//console.log(window)
			expect(window.buffer).to.have.lengthOf(5)
			expect(window.buffer[0]).to.have.property('seq', 101)
			expect(window.buffer[0]).to.have.property('elem').that.is.instanceof(Buffer)
			expect(window.buffer).to.have.lengthOf(5)
			expect(window.buffer[1]).to.have.property('seq', 130)
			assert(window.buffer[1].elem.equals(new Buffer('foobar')))
			expect(window.buffer[2]).to.have.property('seq', 170)
			assert(window.buffer[2].elem.equals(new Buffer('barfoo')))
			expect(window.buffer[3]).to.have.property('seq', 199)
			assert(window.buffer[3].elem.equals(new Buffer('barbar')))
			expect(window.buffer[4]).to.have.property('seq', 200)
			assert(window.buffer[4].elem.equals(new Buffer('bar')))

			expect(packs).to.have.lengthOf(2)
			
			assert(packs[0].equals(new Buffer('foo')))
			
			assert(packs[1].equals(new Buffer('foofoo')))



		})

		it("should wrap maxSeq", function() {
			
			window = new Window(Math.pow(2,16) - 2)
			window.insert(null, 'foo')
			window.insert(null, 'foo1')
			window.insert(null, 'foo2')
			window.insert(null, 'foo3')
			window.removeSequential()
			expect(window.buffer).to.deep.equal([{'seq' : 65538, 'elem' : Buffer.alloc(0)}])
			expect(window.ackNum()).to.equal(2)
		})

	})

	describe("#seqNum", function() {
		it("should increase sequence number to 201", function() {
			//window = new Window(99)
			window = new Window(99)
			window.insert(100, new Buffer('foo'))
			window.insert(200, new Buffer('bar'))
			window.insert(130, new Buffer('foobar'))
			window.insert(170, new Buffer('barfoo'))
			window.insert(199, new Buffer('barbar'))
			window.insert(101, new Buffer('foofoo'))	
			expect(window.seqNum()).to.equal(201)	

		})

		it("should increment sequence number on insert(num, elem)", function() {
			window = new Window(99)
			//console.log(window)
			window.insert(null, new Buffer('foo'))
			//console.log(window)	
			expect(window.seqNum()).to.equal(101)

		})
	})

	describe("#changeWindowSize", function() {


		it("remove elems outside window", function() {
			window = new Window(99)
			window.insert(100, 'foo')
			window.insert(101, 'bar')
			window.insert(102, 'foobar')
			window.insert(103, 'barfoo')
			window.insert(104, 'barbar')
			window.insert(105, 'foofoo')
			packs = window.changeWindowSize(12)	
			expect(window.buffer).to.deep.equal([{'seq':99,'elem':Buffer.alloc(0)},{'seq':100,'elem':'foo'},{'seq':101,'elem':'bar'},
				{'seq':102,'elem':'foobar'}])
			expect(packs).to.deep.equal(['barfoo', 'barbar', 'foofoo'])
		})		

		it("remove elems outside window twice", function() {
			window = new Window(99)
			window.insert(100, 'foo')
			window.insert(101, 'bar')
			window.insert(102, 'foobar')
			window.insert(103, 'barfoo')
			window.insert(104, 'barbar')
			window.insert(105, 'foofoo')
			packs1 = window.changeWindowSize(18)
			packs2 = window.changeWindowSize(12)	
			expect(window.buffer).to.deep.equal([{'seq':99,'elem':Buffer.alloc(0)},{'seq':100,'elem':'foo'},{'seq':101,'elem':'bar'},
				{'seq':102,'elem':'foobar'}])
			expect(packs1).to.deep.equal(['barbar', 'foofoo'])
			expect(packs2).to.deep.equal(['barfoo'])
			
		})		
	})





})