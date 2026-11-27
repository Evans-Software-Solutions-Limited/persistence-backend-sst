import type { ComponentType } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { ClientPage } from "./clients/ClientPage";
import { ClientsListContainer } from "./clients/ClientsListContainer";
import { FormEditorContainer } from "./forms/FormEditorContainer";
import { FormsLibraryContainer } from "./forms/FormsLibraryContainer";
import { InviteContainer } from "./invite/InviteContainer";
import { InvitedClientContainer } from "./invited/InvitedClientContainer";
import { ResourcesLibraryContainer } from "./resources/ResourcesLibraryContainer";
import { SetupContainer } from "./setup/SetupContainer";
import { CoachLayout } from "./shell/CoachLayout";
import { CoachCallback, CoachSignIn } from "./shell/CoachSignIn";
import { WhoContainer } from "./who/WhoContainer";

/**
 * Remount a screen for each client profile. A route that only changes
 * `:profileId` (e.g. a history jump between two clients' set-up pages) would
 * otherwise keep one client's unsaved drafts and save them into the other.
 */
export function PerProfile({ screen: Screen }: { screen: ComponentType }) {
  const { profileId } = useParams();
  return <Screen key={profileId} />;
}

/**
 * The web coach workspace (PER-124), mounted at `/coach/*` and loaded as its
 * own chunk. The marketing nav and footer link to its sign-in (PER-146).
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
          element={<PerProfile screen={InvitedClientContainer} />}
        />
        <Route
          path="clients/invited/:profileId/who"
          element={<PerProfile screen={WhoContainer} />}
        />
        <Route
          path="clients/invited/:profileId/setup/:section?"
          element={<PerProfile screen={SetupContainer} />}
        />
        <Route
          path="clients/invited/:profileId/invite"
          element={<PerProfile screen={InviteContainer} />}
        />
        <Route path="clients/:clientId/:tab?" element={<ClientPage />} />
        {/* PER-129: Library → Forms (C10a–c). */}
        <Route
          path="library"
          element={<Navigate to="/coach/library/forms" replace />}
        />
        <Route path="library/forms" element={<FormsLibraryContainer />} />
        <Route path="library/forms/new" element={<FormEditorContainer />} />
        <Route
          path="library/forms/:formId/edit"
          element={<FormEditorContainer />}
        />
        <Route
          path="library/forms/:formId/:action?"
          element={<FormsLibraryContainer />}
        />
        {/* PER-143: Library → Resources (C5b). */}
        <Route
          path="library/resources"
          element={<ResourcesLibraryContainer />}
        />
        <Route path="*" element={<Navigate to="clients" replace />} />
      </Route>
    </Routes>
  );
}
