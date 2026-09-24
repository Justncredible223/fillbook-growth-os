param(
    [Parameter(Mandatory=$true)][string]$Text,
    [Parameter(Mandatory=$true)][string]$OutPath,
    [string]$VoiceName,
    [int]$Rate = 6
)
# Fully offline: System.Speech is a built-in Windows component (SAPI 5),
# never reaches the network. Used only when no supplied narration audio and
# no network TTS (edge-tts) are available/allowed -- see localTts.ts's own
# doc comment for why this exists and what it deliberately does NOT try to
# match (edge-tts's voice or per-word timing).
#
# Rate default 6 (SAPI's own -10..10 scale, 0 is default pace): SAPI's
# default pace is noticeably slower than the production edge-tts voice for
# the same text -- confirmed on a real render where PILOT_2's second scene
# needed 10.5s at Rate=0 against only 6.4s of captured footage the SAME
# text fits inside at the production voice's pace. This is a narration
# SPEED setting, not touching video timing/footage -- the clip itself is
# still played once, at its own real speed, never accelerated.
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($VoiceName) { $synth.SelectVoice($VoiceName) }
$synth.Rate = $Rate
$synth.SetOutputToWaveFile($OutPath)
$synth.Speak($Text)
$synth.Dispose()
