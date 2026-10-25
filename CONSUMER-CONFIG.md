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

## Host icons

Add an optional `[host_icons]` table to the plugin configuration.
Each key must match the host name exactly.
Radar removes a trailing `.local` from the current host name.
Radar reads that name once when the daemon starts.

```toml
[host_icons]
"kafka-nimbus2000" = "🧹"
"kafka-megatron" = "🤖"
"kafka-mjolnir" = "🔨"
```

Radar puts the matching icon and one space before each group header.
Repeated headers and stale headers use the same icon.
Prefix trimming uses the original workspace label.
A host without an entry gets no icon.
A missing table also adds no icon.
Values can contain emoji or raw private-use characters, such as "".

Herdr measures the full header in terminal columns for each client.
A normal emoji uses two columns.
Herdr cuts the text at a character boundary when the row is too narrow.
Radar sends the full token so clients with different widths can each cut it.
Edit this table in the file. The settings popup does not list host names.
