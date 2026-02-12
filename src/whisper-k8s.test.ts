/**
 * whisper-k8s.test.ts — Structural validation of Whisper K8s manifests.
 *
 * Pure unit tests that load and validate YAML files — no running cluster required.
 */
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

const k8sDir = path.join(process.cwd(), 'k8s', 'whisper');

describe('Whisper K8s manifests', () => {
  describe('deployment.yaml', () => {
    let doc: any;

    function loadDeployment(): any {
      const content = fs.readFileSync(
        path.join(k8sDir, 'deployment.yaml'),
        'utf-8',
      );
      return yaml.load(content);
    }

    it('is valid YAML with correct apiVersion and kind', () => {
      doc = loadDeployment();
      expect(doc).toBeDefined();
      expect(doc.apiVersion).toBe('apps/v1');
      expect(doc.kind).toBe('Deployment');
    });

    it('targets tenant-rahulkul namespace', () => {
      doc = loadDeployment();
      expect(doc.metadata.namespace).toBe('tenant-rahulkul');
    });

    it('uses the faster-whisper-server image', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      expect(container.image).toMatch(/^fedirz\/faster-whisper-server/);
    });

    it('sets resource limits (512Mi memory, 1000m CPU)', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      expect(container.resources.limits.memory).toBe('512Mi');
      expect(container.resources.limits.cpu).toBe('1000m');
    });

    it('sets resource requests (256Mi memory, 250m CPU)', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      expect(container.resources.requests.memory).toBe('256Mi');
      expect(container.resources.requests.cpu).toBe('250m');
    });

    it('configures whisper-small model via WHISPER__MODEL env', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      const modelEnv = container.env.find(
        (e: any) => e.name === 'WHISPER__MODEL',
      );
      expect(modelEnv).toBeDefined();
      expect(modelEnv.value).toContain('faster-whisper-small');
    });

    it('configures CPU inference via WHISPER__INFERENCE_DEVICE env', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      const deviceEnv = container.env.find(
        (e: any) => e.name === 'WHISPER__INFERENCE_DEVICE',
      );
      expect(deviceEnv).toBeDefined();
      expect(deviceEnv.value).toBe('cpu');
    });

    it('has readiness probe on /health', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      expect(container.readinessProbe).toBeDefined();
      expect(container.readinessProbe.httpGet.path).toBe('/health');
      expect(container.readinessProbe.httpGet.port).toBe(8000);
    });

    it('has liveness probe on /health', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      expect(container.livenessProbe).toBeDefined();
      expect(container.livenessProbe.httpGet.path).toBe('/health');
      expect(container.livenessProbe.httpGet.port).toBe(8000);
    });

    it('exposes container port 8000', () => {
      doc = loadDeployment();
      const container = doc.spec.template.spec.containers[0];
      const port = container.ports.find((p: any) => p.containerPort === 8000);
      expect(port).toBeDefined();
      expect(port.name).toBe('http');
    });

    it('has app: whisper label in pod template', () => {
      doc = loadDeployment();
      expect(doc.spec.template.metadata.labels.app).toBe('whisper');
    });

    it('selector matches pod labels', () => {
      doc = loadDeployment();
      expect(doc.spec.selector.matchLabels.app).toBe('whisper');
      expect(doc.spec.template.metadata.labels.app).toBe('whisper');
    });
  });

  describe('service.yaml', () => {
    let doc: any;

    function loadService(): any {
      const content = fs.readFileSync(
        path.join(k8sDir, 'service.yaml'),
        'utf-8',
      );
      return yaml.load(content);
    }

    it('is valid YAML with correct apiVersion and kind', () => {
      doc = loadService();
      expect(doc).toBeDefined();
      expect(doc.apiVersion).toBe('v1');
      expect(doc.kind).toBe('Service');
    });

    it('is named whisper-svc', () => {
      doc = loadService();
      expect(doc.metadata.name).toBe('whisper-svc');
    });

    it('is in tenant-rahulkul namespace', () => {
      doc = loadService();
      expect(doc.metadata.namespace).toBe('tenant-rahulkul');
    });

    it('is ClusterIP type', () => {
      doc = loadService();
      expect(doc.spec.type).toBe('ClusterIP');
    });

    it('exposes port 9000', () => {
      doc = loadService();
      const port = doc.spec.ports[0];
      expect(port.port).toBe(9000);
    });

    it('targets container port 8000', () => {
      doc = loadService();
      const port = doc.spec.ports[0];
      expect(port.targetPort).toBe(8000);
    });

    it('selects app: whisper pods', () => {
      doc = loadService();
      expect(doc.spec.selector.app).toBe('whisper');
    });
  });
});
