import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../layout/AppShell';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { WazuhDashboardPage } from '../pages/WazuhDashboardPage';
import { TicketsPage } from '../pages/TicketsPage';
import { TicketEditorPage } from '../pages/TicketEditorPage';
import { ThreatHuntsPage } from '../pages/ThreatHuntsPage';
import { HuntConsolePage } from '../pages/HuntConsolePage';
import { EvidenceCenterPage } from '../pages/EvidenceCenterPage';
import { DetectionLibraryPage } from '../pages/DetectionLibraryPage';
import { SettingsPage } from '../pages/SettingsPage';
import { KiAgentPage } from '../pages/KiAgentPage';
import { ProfilePage } from '../pages/ProfilePage';
import { AnalysisPage } from '../pages/AnalysisPage';
import { HostsPage } from '../pages/HostsPage';
import { MitrePage } from '../pages/MitrePage';
import { YaraPage } from '../pages/YaraPage';
import { HuntLibraryPage } from '../pages/HuntLibraryPage';
import { QRadarAnalysisPage } from '../pages/QRadarAnalysisPage';
import { SystemStatusPage } from '../pages/SystemStatusPage';
import { AuditLogPage } from '../pages/AuditLogPage';
import { UseCaseDeveloperPage } from '../pages/UseCaseDeveloperPage';
import { SocMetricsDashboardPage } from '../pages/SocMetricsDashboardPage';
import { AutonomyPoliciesPage } from '../pages/AutonomyPoliciesPage';
import { ProvisioningPage } from '../pages/ProvisioningPage';
import { CorrelatorsPage } from '../pages/CorrelatorsPage';
import { DeployPage } from '../pages/DeployPage';
import { CollectorsStatusPage } from '../pages/CollectorsStatusPage';
import { DataPlanePage } from '../pages/DataPlanePage';
import { Nis2ReadinessPage } from '../pages/Nis2ReadinessPage';
import { MlEvalPage } from '../pages/MlEvalPage';
import { ServicesPage } from '../pages/ServicesPage';
import { IntegrationsConfigPage } from '../pages/IntegrationsConfigPage';
import { CategoryLandingPage } from '../pages/CategoryLandingPage';
import { HuntingSettingsPage } from '../pages/HuntingSettingsPage';
import { AuditCompliancePage } from '../pages/AuditCompliancePage';
import { WikiPage } from '../pages/WikiPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Kategorie-Landing-Pages — anklickbare Gruppen-Übersichten (Sub-Page-Kacheln) */}
        <Route path="/hunting" element={<CategoryLandingPage group="hunting" />} />
        <Route path="/detection" element={<CategoryLandingPage group="detection" />} />
        <Route path="/integrations" element={<CategoryLandingPage group="integrations" />} />
        <Route path="/deployment" element={<CategoryLandingPage group="deployment" />} />
        <Route path="/monitoring" element={<CategoryLandingPage group="monitoring" />} />
        <Route path="/ki" element={<CategoryLandingPage group="ki" />} />

        <Route path="/wazuh" element={<WazuhDashboardPage />} />
        <Route path="/integrations/config" element={<IntegrationsConfigPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />

        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/tickets/new" element={<TicketEditorPage />} />
        <Route path="/tickets/:id" element={<TicketEditorPage />} />

        <Route path="/hosts" element={<HostsPage />} />

        <Route path="/threat-hunts" element={<ThreatHuntsPage />} />
        <Route path="/threat-hunts/:id" element={<HuntConsolePage />} />
        <Route path="/hunt-library" element={<HuntLibraryPage />} />
        <Route path="/hunting/settings" element={<HuntingSettingsPage />} />

        <Route path="/evidence" element={<EvidenceCenterPage />} />
        <Route path="/detections" element={<DetectionLibraryPage />} />
        <Route path="/mitre" element={<MitrePage />} />
        <Route path="/yara" element={<YaraPage />} />
        <Route path="/qradar" element={<QRadarAnalysisPage />} />
        <Route path="/use-case-developer" element={<UseCaseDeveloperPage />} />
        <Route path="/soc-metrics" element={<SocMetricsDashboardPage />} />
        <Route path="/system" element={<SystemStatusPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="/ki-agent" element={<KiAgentPage />} />
        <Route path="/autonomy-policies" element={<AutonomyPoliciesPage />} />
        <Route path="/provisioning" element={<ProvisioningPage />} />
        <Route path="/correlators" element={<CorrelatorsPage />} />
        <Route path="/deploy" element={<DeployPage />} />
        <Route path="/ml-eval" element={<MlEvalPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/collectors" element={<CollectorsStatusPage />} />
        <Route path="/dataplane" element={<DataPlanePage />} />
        <Route path="/compliance/nis2" element={<Nis2ReadinessPage />} />
        <Route path="/compliance/audit" element={<AuditCompliancePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/wiki" element={<WikiPage />} />
        <Route path="/wiki/*" element={<WikiPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
