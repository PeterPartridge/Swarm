//! Reading and writing files inside a Solution's working copy.
//!
//! `workspace` reads the file tree and the diffs the Code tab shows; `emit`
//! writes generated files, containment-checked so nothing lands outside the
//! folder it was meant for; `pack` and `work_item_files` build the documents an
//! agent reads — the capability pack and a work item's `.md`/`.json` pair.

pub mod emit;
pub mod pack;
pub mod work_item_files;
pub mod workspace;
