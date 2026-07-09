import { useAdmin } from '../AdminContext';

/** Action-feedback toast (README §2): fixed bottom-right, navy bg, gold border/text, `gxin` entry. */
export function Toast() {
  const { toast, clearToast } = useAdmin();
  if (!toast) return null;
  return (
    <button type="button" className="gx-adm-toast" onClick={clearToast} role="status">
      {toast}
    </button>
  );
}
