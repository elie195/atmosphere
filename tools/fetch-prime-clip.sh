#!/bin/sh
# Downloads the Dolby Atmos (DD+ JOC) test clip that Atmosphere plays, near-silently,
# to switch Safari's audio output into Dolby Atmos mode. It comes from Dolby's public
# Digital Plus Online Delivery Kit and is not redistributed in this repository.
set -e
cd "$(dirname "$0")/.."
curl -fL -o netflix-atmos/prime.mp4 \
  "https://ott.dolby.com/OnDelKits/DDP/Dolby_Digital_Plus_Online_Delivery_Kit_v1.4.1/Test_Signals/muxed_streams/DASH/OnDemand_MPD/Fragment_Audio/ChID_voices_Atmos_6ch_640kbps_ddp_joc.mp4"
echo "Saved netflix-atmos/prime.mp4"
