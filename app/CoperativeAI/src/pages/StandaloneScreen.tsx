import { useEffect, useState } from "react";
import { WorkspaceScreen, type ScreenId } from "../components/ProductWorkspace";
import { getProduct, type Product } from "../lib/backend";
import { PermissionProvider, usePermissions } from "../lib/permissions";

interface StandaloneScreenProps {
  screen: ScreenId;
  productId: number;
}

function StandaloneBody({ screen, productId }: StandaloneScreenProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { canAccess } = usePermissions();

  useEffect(() => {
    getProduct(productId).then(setProduct).catch((e) => setError(String(e)));
  }, [productId]);

  if (error) return <p role="alert">{error}</p>;
  if (!product) return <p>Loading…</p>;

  // The workspace hides these panels from roles without the flags; a window
  // opened by hand must not be the way around that. Visibility, not security
  // — like every role gate here — but the two doors should at least agree.
  if ((screen === "marketing" || screen === "design") && !canAccess(screen)) {
    return (
      <p role="status">
        Your role doesn't include the {screen} screen — an Admin can grant it
        in the Admin area.
      </p>
    );
  }

  return (
    <div className="standalone-screen">
      <header className="workspace-header">
        <h2>{product.name}</h2>
        <span className="screen-name">{screen}</span>
      </header>
      <WorkspaceScreen screen={screen} productId={productId} product={product} />
    </div>
  );
}

/** What a pulled-out OS window shows: one workspace screen for one Product,
 *  with the Product's title at the top. Wrapped in its own PermissionProvider
 *  because a pop-out renders outside the main shell's tree. */
export default function StandaloneScreen(props: StandaloneScreenProps) {
  return (
    <PermissionProvider>
      <StandaloneBody {...props} />
    </PermissionProvider>
  );
}
