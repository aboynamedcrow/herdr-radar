# Configuration owned by a consumer

Set `external_config = true` when another configuration repository owns
sidebar rows, terminal settings, and theme values.
Radar skips first-run setup and all managed configuration edits.
It still publishes tokens and maintains its native Agent view.
The consumer must supply the rows and install the font if needed.

Set `prefer_pane_labels = true` to prefer explicit pane labels over terminal titles.
Radar reads pane labels at most once every five seconds.
A pane without a label uses the existing title behavior.

Both settings default to false. Existing installations keep their behavior.
