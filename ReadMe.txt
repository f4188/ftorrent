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
