//! Admin-area Role commands + the active-user resolution the permission gate
//! reads. Roles gate visibility only (no login).

use super::{to_message, AppDb};
use crate::db::role::{self, Role};
use crate::db::{system_setting, team_member};
use serde::Serialize;
use tauri::State;

pub const ACTIVE_MEMBER_KEY: &str = "activeTeamMemberId";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleDto {
    pub id: i64,
    pub name: String,
    pub can_product: bool,
    pub can_develop: bool,
    pub can_test: bool,
    pub can_admin: bool,
    pub see_cost: bool,
    pub see_profit: bool,
    pub see_chargeable: bool,
    pub can_manage_budget: bool,
}

impl From<Role> for RoleDto {
    fn from(r: Role) -> Self {
        RoleDto {
            id: r.id,
            name: r.name,
            can_product: r.can_product,
            can_develop: r.can_develop,
            can_test: r.can_test,
            can_admin: r.can_admin,
            see_cost: r.see_cost,
            see_profit: r.see_profit,
            see_chargeable: r.see_chargeable,
            can_manage_budget: r.can_manage_budget,
        }
    }
}

/// The active user's effective permissions. `member_id: None` (no active user
/// / no members yet) resolves to full access so you can never lock yourself
/// out of a fresh install.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePermissions {
    pub member_id: Option<i64>,
    pub role: Option<RoleDto>,
    pub can_product: bool,
    pub can_develop: bool,
    pub can_test: bool,
    pub can_admin: bool,
    pub see_cost: bool,
    pub see_profit: bool,
    pub see_chargeable: bool,
    pub can_manage_budget: bool,
}

#[tauri::command]
pub async fn list_roles(db: State<'_, AppDb>) -> Result<Vec<RoleDto>, String> {
    let conn = db.0.lock().await;
    let roles = role::list_all(&conn).await.map_err(to_message)?;
    Ok(roles.into_iter().map(RoleDto::from).collect())
}

#[tauri::command]
pub async fn create_role(db: State<'_, AppDb>, name: String) -> Result<i64, String> {
    let conn = db.0.lock().await;
    role::create(&conn, &name).await.map_err(to_message)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_role(
    db: State<'_, AppDb>,
    id: i64,
    can_product: bool,
    can_develop: bool,
    can_test: bool,
    can_admin: bool,
    see_cost: bool,
    see_profit: bool,
    see_chargeable: bool,
    can_manage_budget: bool,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    role::update(
        &conn, id, can_product, can_develop, can_test, can_admin, see_cost, see_profit,
        see_chargeable, can_manage_budget,
    )
    .await
    .map_err(to_message)
}

#[tauri::command]
pub async fn delete_role(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    role::delete(&conn, id).await.map_err(to_message)
}

#[tauri::command]
pub async fn get_active_member(db: State<'_, AppDb>) -> Result<Option<i64>, String> {
    let conn = db.0.lock().await;
    read_active_member(&conn).await
}

#[tauri::command]
pub async fn set_active_member(db: State<'_, AppDb>, id: Option<i64>) -> Result<(), String> {
    let conn = db.0.lock().await;
    let json = serde_json::to_string(&id).expect("serialize id");
    system_setting::set(&conn, ACTIVE_MEMBER_KEY, &json)
        .await
        .map_err(to_message)
}

/// The permission gate the shell reads to hide tabs and cost fields.
#[tauri::command]
pub async fn get_active_permissions(db: State<'_, AppDb>) -> Result<ActivePermissions, String> {
    let conn = db.0.lock().await;
    let member_id = read_active_member(&conn).await?;
    let role = match member_id {
        Some(mid) => match team_member::find_by_id(&conn, mid).await.map_err(to_message)? {
            Some(member) => match member.role_id {
                Some(rid) => role::find_by_id(&conn, rid).await.map_err(to_message)?,
                None => None,
            },
            None => None,
        },
        None => None,
    };
    Ok(match role {
        Some(r) => ActivePermissions {
            member_id,
            can_product: r.can_product,
            can_develop: r.can_develop,
            can_test: r.can_test,
            can_admin: r.can_admin,
            see_cost: r.see_cost,
            see_profit: r.see_profit,
            see_chargeable: r.see_chargeable,
            can_manage_budget: r.can_manage_budget,
            role: Some(RoleDto::from(r)),
        },
        // No active user or an unassigned member → full access (safe default).
        None => ActivePermissions {
            member_id,
            role: None,
            can_product: true,
            can_develop: true,
            can_test: true,
            can_admin: true,
            see_cost: true,
            see_profit: true,
            see_chargeable: true,
            can_manage_budget: true,
        },
    })
}

async fn read_active_member(conn: &turso::Connection) -> Result<Option<i64>, String> {
    match system_setting::get(conn, ACTIVE_MEMBER_KEY).await.map_err(to_message)? {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or(None)),
        None => Ok(None),
    }
}
