'use strict';

const { UseCaseDeveloperService }             = require('./UseCaseDeveloperService');
const { createUseCaseDraftRepository }        = require('../repositories/useCaseDraftRepositoryFactory');
const { createPublishedDetectionRepository }  = require('../repositories/publishedDetectionRepositoryFactory');
const { validateUseCaseDraft }                = require('./UseCaseQualityValidator');
const { StubUseCaseDeveloperProvider }        = require('../agents/usecase/StubUseCaseDeveloperProvider');
const { OllamaUseCaseDeveloperProvider }      = require('../agents/usecase/OllamaUseCaseDeveloperProvider');
const { ticketService }                       = require('./TicketService');

// Provider-Switch wie beim KI-Agenten: AGENT_LLM_PROVIDER='ollama' nutzt das
// lokale Modell, sonst der deterministische Stub (sicher, kein Ollama nötig).
const provider = process.env.AGENT_LLM_PROVIDER === 'ollama'
  ? new OllamaUseCaseDeveloperProvider({})
  : new StubUseCaseDeveloperProvider();

// Shared singleton — Route und Service nutzen dieselbe Instanz (wichtig für InMemory-Modus).
const publishedDetectionRepo = createPublishedDetectionRepository();

const useCaseDeveloperService = new UseCaseDeveloperService({
  repo:          createUseCaseDraftRepository(),
  provider,
  validator:     validateUseCaseDraft,
  ticketService,
  detectionRepo: publishedDetectionRepo,
});

module.exports = { useCaseDeveloperService, publishedDetectionRepo };
