import { Navigate, Route, Routes } from "react-router";
import { ClientPage } from "./clients/ClientPage";
import { ClientsListContainer } from "./clients/ClientsListContainer";
import { InviteContainer } from "./invite/InviteContainer";
import { InvitedClientContainer } from "./invited/InvitedClientContainer";
import { SetupContainer } from "./setup/SetupContainer";
import { CoachLayout } from "./shell/CoachLayout";
import { CoachCallback, CoachSignIn } from "./shell/CoachSignIn";
import { WhoContainer } from "./who/WhoContainer";

/**
 * The web coach workspace (PER-124), mounted at `/coach/*` and loaded as its
 * own chunk. Not linked from the marketing site.
 */
export default function CoachApp() {
  return (
    <Routes>
      <Route path="login" element={<CoachSignIn />} />
      <Route path="callback" element={<CoachCallback />} />
      <Route element={<CoachLayout />}>
        <Route index element={<Navigate to="clients" replace />} />
        <Route path="clients" element={<ClientsListContainer />} />
        <Route path="clients/new" element={<WhoContainer />} />
        <Route
          path="clients/invited/:profileId"
          element={<InvitedClientContainer />}
        />
        <Route
          path="clients/invited/:profileId/who"
          element={<WhoContainer />}
        />
        <Route
          path="clients/invited/:profileId/setup/:section?"
          element={<SetupContainer />}
        />
        <Route
          path="clients/invited/:profileId/invite"
          element={<InviteContainer />}
        />
        <Route path="clients/:clientId/:tab?" element={<ClientPage />} />
        <Route path="*" element={<Navigate to="clients" replace />} />
      </Route>
    </Routes>
  );
}
