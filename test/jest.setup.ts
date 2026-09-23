// Keep colourised output deterministic when snapshots capture terminal output.
process.env.FORCE_COLOR = "1";
delete process.env.NO_COLOR;
