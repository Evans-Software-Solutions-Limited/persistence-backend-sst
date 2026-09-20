import { useFoundingAccess } from "./useFoundingAccess";
import { FoundingAccessPresenter } from "./FoundingAccessPresenter";
import "../redemption/redemption.css";
import "./foundingAccess.css";
export default function FoundingAccess() {
  return <FoundingAccessPresenter {...useFoundingAccess()} />;
}
