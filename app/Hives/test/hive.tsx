import type { Hive } from "../types";
import TestArea from "./TestArea";

const test: Hive = {
  id: "test",
  label: "Test",
  color: "#16a34a",
  // A tick: a test that passed.
  icon: (
    <path
      d="M4 10.5l4 4 8-9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  Screen: TestArea,
};

export default test;
