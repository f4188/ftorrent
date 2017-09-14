
To setup:
(1) clone repo
(2) cmd: npm install
(3) cmd: electron ./main.js 

or start up term ui 
cmd: ./swarm/client.js -u

------------------------------------------------------------------------------------

udp tracker  *****
http tracker *****

base client ****
- download/connect lg *****
- peer wire protocol *****
- multifile downloads *****
extended message protocol *****
- metadata exchange *****
- peer exchange ***
DHT ****
fast extension
local service disc - easy
private torrents
multitracker extension 

terminal ui *** 
gui ****
uTP protocol ****
 
not started
*half done
**mostly done, not tested
***mostly done, partly tested
****complete, tested, working, features left
*****complete

issues
- not exchanging DHT port messages with conn peers
- not sending periodic peer exchange msg
- now piece.js writes everything to disk - however not sure if everything written
- randReq in piece needlessly looping ** high cpu usage
- announcing on all urls - should respect tiers
- server not accept req - fixed
- merge getPeersIter and findNodesIter
- need to test with larger active piece set 
- unchokeLoop not working - seedloop working fine
- need to clear out peerStats
- ?? close file descripters 
- clean up piece.js 

fast ex / have all, have none / reject req / sug piece / allowed fast 





