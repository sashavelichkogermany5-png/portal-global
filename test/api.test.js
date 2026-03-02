import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';

describe('API Endpoints', () => {
  const baseUrl = 'http://localhost:3000/api';

  beforeEach(() => {
    // Setup code if needed
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await axios.get(`${baseUrl}/health`);
      
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect(response.data.ok).toBe(true);
      expect(response.data.ts).toBeDefined();
      expect(response.data.uptime).toBeDefined();
      expect(response.data.memory).toBeDefined();
    });
  });

  describe('Chat API', () => {
    it('should respond to chat message', async () => {
      const response = await axios.post(`${baseUrl}/chat`, {
        message: 'Hello'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect(response.data.ok).toBe(true);
      expect(response.data.reply).toBeDefined();
      expect(response.data.suggestions).toBeDefined();
      expect(response.data.timestamp).toBeDefined();
    });

    it('should handle empty message', async () => {
      try {
        await axios.post(`${baseUrl}/chat`, {
          message: ''
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('Invalid message');
      }
    });
  });

  describe('AI Project API', () => {
    it('should generate project idea', async () => {
      const response = await axios.post(`${baseUrl}/ai-project`, {
        idea: 'Create a new project'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect(response.data.ok).toBe(true);
      expect(response.data.projectName).toBeDefined();
      expect(response.data.timeline).toBeDefined();
      expect(response.data.teamSize).toBeDefined();
      expect(response.data.budget).toBeDefined();
      expect(response.data.techStack).toBeDefined();
      expect(response.data.risk).toBeDefined();
      expect(response.data.recommendations).toBeDefined();
    });

    it('should handle short idea', async () => {
      try {
        await axios.post(`${baseUrl}/ai-project`, {
          idea: 'Hi'
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.error).toBe('Invalid idea');
      }
    });
  });

  describe('Stats API', () => {
    it('should return system stats', async () => {
      const response = await axios.get(`${baseUrl}/stats`);
      
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect(response.data.ok).toBe(true);
      expect(response.data.totalProjects).toBeDefined();
      expect(response.data.activeOrders).toBeDefined();
      expect(response.data.clients).toBeDefined();
      expect(response.data.providers).toBeDefined();
      expect(response.data.aiRequests).toBeDefined();
      expect(response.data.uptime).toBeDefined();
      expect(response.data.memoryUsage).toBeDefined();
    });
  });
});