//! Admin-area Role commands + the active-user resolution the permission gate
//! reads. Roles gate visibility only (no login).

use super::{to_message, AppDb};
use crate::db::role::{self, Role};
use crate::db::{role_hive, system_setting, team_member};
use serde::Serialize;
use tauri::State;

pub const ACTIVE_MEMBER_KEY: &str = "activeTeamMemberId";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleDto {
    pub id: i64,
    pub name: String,
    /// The Hives this role was granted (`role_hives`), by id.
    pub hives: Vec<String>,
    /// Admin sees every Hive whatever `hives` says, including ones added
    /// after its grants were set — so the frontend never has to know which
    /// role is the one that cannot be locked out.
    pub all_hives: bool,
    pub can_admin: bool,
    pub see_cost: bool,
    pub see_profit: bool,
    pub see_chargeable: bool,
    pub can_manage_budget: bool,
    pub can_marketing: bool,
    pub can_design: bool,
}

/// A role as the frontend sees it, with its Hive grants read alongside.
///
/// The old `canProduct` / `canDevelop` / `canTest` columns are not sent:
/// `role_hives` replaced them, and a field nothing should read is one
/// somebody eventually reads.
async fn role_dto(conn: &turso::Connection, r: Role) -> Result<RoleDto, String> {
    let all_hives = r.name == "Admin";
    let hives = role_hive::hives_for(conn, r.id).await.map_err(to_message)?;
    Ok(RoleDto {
        id: r.id,
        name: r.name,
        hives,
        all_hives,
        can_admin: r.can_admin,
        see_cost: r.see_cost,
        see_profit: r.see_profit,
        see_chargeable: r.see_chargeable,
        can_manage_budget: r.can_manage_budget,
        can_marketing: r.can_marketing,
        can_design: r.can_design,
    })
}

/// The active user's effective permissions. `member_id: None` (no active user
/// / no members yet) resolves to full access so you can never lock yourself
/// out of a fresh install.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePermissions {
    pub member_id: Option<i64>,
    pub role: Option<RoleDto>,
    /// The Hives the active user may open; `all_hives` overrides it.
    pub hives: Vec<String>,
    pub all_hives: bool,
    pub can_admin: bool,
    pub see_cost: bool,
    pub see_profit: bool,
    pub see_chargeable: bool,
    pub can_manage_budget: bool,
    pub can_marketing: bool,
    pub can_design: bool,
}

#[tauri::command]
pub async fn list_roles(db: State<'_, AppDb>) -> Result<Vec<RoleDto>, String> {
    let conn = db.0.lock().await;
    let mut dtos = Vec::new();
    for r in role::list_all(&conn).await.map_err(to_message)? {
        dtos.push(role_dto(&conn, r).await?);
    }
    Ok(dtos)
}

#[tauri::command]
pub async fn create_role(db: State<'_, AppDb>, name: String) -> Result<i64, String> {
    let conn = db.0.lock().await;
    role::create(&conn, &name).await.map_err(to_message)
}

/// Sets a role's flags. Which Hives it sees is `set_role_hive`; the old area
/// columns are passed through untouched, since nothing reads them any more.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_role(
    db: State<'_, AppDb>,
    id: i64,
    can_admin: bool,
    see_cost: bool,
    see_profit: bool,
    see_chargeable: bool,
    can_manage_budget: bool,
    can_marketing: bool,
    can_design: bool,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    let Some(r) = role::find_by_id(&conn, id).await.map_err(to_message)? else {
        return Err(format!("no role with id {id}"));
    };
    role::update(
        &conn, id, r.can_product, r.can_develop, r.can_test, can_admin, see_cost, see_profit,
        see_chargeable, can_manage_budget, can_marketing, can_design,
    )
    .await
    .map_err(to_message)
}

/// Grants or revokes one Hive for one role — the Admin area's Hive columns.
/// Refused for the Admin role, which sees every Hive regardless.
#[tauri::command]
pub async fn set_role_hive(
    db: State<'_, AppDb>,
    role_id: i64,
    hive_id: String,
    allowed: bool,
) -> Result<(), String> {
    let conn = db.0.lock().await;
    role_hive::set(&conn, role_id, &hive_id, allowed)
        .await
        .map_err(to_message)
}

#[tauri::command]
pub async fn delete_role(db: State<'_, AppDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().await;
    role::delete(&conn, id).await.map_err(to_message)?;
    role_hive::clear_role(&conn, id).await.map_err(to_message)
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
        Some(r) => {
            let dto = role_dto(&conn, r).await?;
            ActivePermissions {
                member_id,
                hives: dto.hives.clone(),
                all_hives: dto.all_hives,
                can_admin: dto.can_admin,
                see_cost: dto.see_cost,
                see_profit: dto.see_profit,
                see_chargeable: dto.see_chargeable,
                can_manage_budget: dto.can_manage_budget,
                can_marketing: dto.can_marketing,
                can_design: dto.can_design,
                role: Some(dto),
            }
        }
        // No active user or an unassigned member → full access (safe default).
        None => ActivePermissions {
            member_id,
            role: None,
            hives: Vec::new(),
            all_hives: true,
            can_admin: true,
            see_cost: true,
            see_profit: true,
            see_chargeable: true,
            can_manage_budget: true,
            can_marketing: true,
            can_design: true,
        },
    })
}

async fn read_active_member(conn: &turso::Connection) -> Result<Option<i64>, String> {
    match system_setting::get(conn, ACTIVE_MEMBER_KEY).await.map_err(to_message)? {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or(None)),
        None => Ok(None),
    }
}
