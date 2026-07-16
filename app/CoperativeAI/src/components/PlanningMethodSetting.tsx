import { useCallback, useEffect, useState } from "react";
import {
  getPlanningHierarchy,
  getRoadmapMode,
  setPlanningHierarchy,
  setRoadmapMode,
  HIERARCHY_PRESETS,
  ROADMAP_MODES,
} from "../lib/backend";

/** The "How Products are planned" system settings. */
export default function PlanningMethodSetting() {
  const [hierarchy, setHierarchy] = useState<string>("");
  const [mode, setMode] = useState<string>("sprints");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedHierarchy, loadedMode] = await Promise.all([
        getPlanningHierarchy(),
        getRoadmapMode(),
      ]);
      setHierarchy(JSON.stringify(loadedHierarchy));
      setMode(loadedMode);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onHierarchyChange(value: string) {
    try {
      await setPlanningHierarchy(JSON.parse(value));
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onModeChange(value: string) {
    try {
      await setRoadmapMode(value);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="planning-settings" aria-label="Planning settings">
      {error && <p role="alert">{error}</p>}
      <label>
        How Products are planned
        <select
          value={hierarchy}
          onChange={(e) => onHierarchyChange(e.target.value)}
        >
          {HIERARCHY_PRESETS.map((preset) => (
            <option key={preset.label} value={JSON.stringify(preset.value)}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        RoadMap style
        <select value={mode} onChange={(e) => onModeChange(e.target.value)}>
          {ROADMAP_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
