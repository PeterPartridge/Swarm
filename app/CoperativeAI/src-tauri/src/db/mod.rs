pub mod role;

use turso::{Builder, Connection, Database};

/// Opens the CoperativeAI database at the given path (or an in-memory database
/// for `:memory:`, used by tests) and returns a ready connection.
pub async fn connect(path: &str) -> turso::Result<Connection> {
    let db: Database = Builder::new_local(path).build().await?;
    db.connect()
}
