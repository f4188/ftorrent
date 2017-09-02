
var assert = require('assert')
var Window = require('./Window.js')
var sinon = require('sinon')
var expect = require('chai').expect

describe('DHT', function() {


}


describe('Node', function() {

	//describe()



})

describe('Bucket', function() {

	beforeEach(function () {
		bucket = new Bucket(0, 2**160)
		bucket2 = new Bucket(2**159, 2**159 + 2**158)
		nodeID = crypto.randomBytes(20)
	})

	describe('fits', function() {
		bucket.fits()
	})

	describe('contains')

	describe('isEmpty')

	describe('isFull')

	describe('insert')

	describe('remove')

	describe('get')

	describe('getBucketNodeIDs')

	describe('split')

})
