import { useState, type FormEvent } from "react";
import { createProduct, type ProductArea } from "../../lib/backend";

const AREA_NAME: Record<Exclude<ProductArea, "product">, string> = {
  develop: "Develop",
  test: "Test",
};

/** Starting a project from Develop or Test.
 *
 *  **A project is a Product** — the same record, made by the same
 *  `create_product` the Product tab uses, so Solutions, rules and work items
 *  attach to it exactly as they do to any other. It exists because the
 *  Developer and QA roles cannot open the Product tab, and every Solution needs
 *  a Product: without this, they could not start anything on their own.
 *
 *  **It stays in the area that made it** until somebody sends it to Product
 *  (`SendToProduct`); only then does the Product tab list it.
 *
 *  **Name only.** The Product brief's questions are Product's to answer, and the
 *  framework-file scaffold stays with the Product tab's form.
 *
 *  **AI stays off.** Policy is deny-by-default and set in Admin; the form says
 *  so rather than leaving a developer to find out from a refusal. */
export default function NewProjectForm({
  origin,
  onCreated,
}: {
  /** The area the project is started in, and stays in until it is sent. */
  origin: Exclude<ProductArea, "product">;
  /** The new Product's id, once the row exists. */
  onCreated: (productId: number) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const wanted = name.trim();
    if (!wanted) return;
    try {
      const id = await createProduct(wanted, "{}", undefined, origin);
      setName("");
      setError(null);
      onCreated(id);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <form onSubmit={submit} aria-label="New project">
      {error && <p role="alert">{error}</p>}
      <label>
        Project name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Create project</button>
      <p className="hint">
        A project stays in {AREA_NAME[origin]} until you send it to Product. AI is off
        for a new project until an Admin allows it (Admin → AI).
      </p>
    </form>
  );
}
