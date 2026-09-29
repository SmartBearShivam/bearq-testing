# Drop your Paligo export here

Put your **unzipped Paligo DocBook export** in this folder, then run
`../migrate.sh` (or `npm run migrate` from the parent folder).

Either layout works:

- the export files directly here — a `resource-<id>.xml` plus an `assets/` folder, **or**
- the whole exported sub-folder dropped in unchanged (the engine looks one level down too).

This folder is otherwise kept empty so the tool stays reusable.
