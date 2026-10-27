//! Developer/Admin team commands — members with an assigned Role.

use super::{to_message, AppDb};
use crate::db::team_member::{self, TeamMember};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberDto {
    pub id: i64,
    pub name: String,
    pub role_id: Option<i64>,
}

impl From<TeamMember> for TeamMemberDto {
    fn from(m: TeamMember) -> Self {
        TeamMemberDto {
            id: m.id,
            name: m.name,
            role_id: m.role_id,
        }
    }
}

#[tauri::command]
pub async fn list_team_members(db: State<'_, AppDb>) -> Result<Vec<TeamMemberDto>, String> {
    let conn = db.0.lock().await;
    let members = team_member::list_all(&conn).await.map_err(to_message)?;
    Ok(members.into_iter().map(TeamMemberDto::from).collect())
}

#[tauri::command]
pub async fn add_team_member(
    db: State<'_, AppDb>,
    name: String,
    role_id: Option<i64>,
) -> Result<i64, String> {
    let conn = db.0.lock().await;
    team_member::add(&conn, &name, role_id).await.map_err(to_message)
}

#[tauri::command]
pub async fn set_member_role(
    db: State<'_, AppDb>,
    id: i64,
    role_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    team_member::set_role(&conn, id, role_id).await.map_err(to_message)
}

#[tauri::command]
pub async fn remove_team_member(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    team_member::remove(&conn, id).await.map_err(to_message)
}
