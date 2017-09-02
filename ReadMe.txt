
fztorrent

udp tracker  ****
http tracker ***

base client ****
- download logic ***/* 
- peer wire protocol *****
extended message protocol ***
- metadata exchange **
- peer exchange **
DHT **** - need to test announce
- console output
 
uTP protocol ****
 
not done
*half done
**mostly done, not tested
***mostly done, partly tested
****complete, tested, working, features left
*****complete

______________________________________


	/* :::: for leechers ::::

	(1) only mutually interested 
	unamchoked --- unchoked - (if active do nothing - if idle) unchoke by upload -- should be 8
	unamchoked --- choked - unchoke by upload            --have unchoked me - maybe have chosen me as opt unchoke (amOpt)
	amchoked ----- unchoked - choke                      --have choked me  -- maybe choose as opt unchoke if new (opt)
	amchoked ----- choke - do nothing                    -- not interested
	 

	(2) amUnInterested - interested  ------- select as opt unchoke (opt)
		amchoked -- choked

	(3) amInterested - unInterested  ------- might select me as opt unchoke (amOpt)
		amchoked -- choked
		
	(4) mutually uninterested     - have same pieces or no pieces or both seeders
		amchoked -- choked
	*/



max_window = max number of bytes in flight
cur_window = number of bytes in flight
wnd_size = window at other end

send packet is packetsize + cur_window < max(max_window + wnd_size)

possible that packetsize > max_window
then average cur_window must satisfy inequality

socket has reply_micro - packet send delay
on receipt of new packet, update reply_micro
by subtracting timestamp_microseconds from current time
reply_micro sent as time_difference_microseconds


seq_nr 
ack_nr

oldest un_anacked packet is seq_nr - cur_window


dataBuffer => sendWindow =>

=>recvWindow => push to user