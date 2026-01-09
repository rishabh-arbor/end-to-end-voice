/**
 * LLM Module Index
 * 
 * @module llm
 * @description Re-exports all LLM-related modules for convenient importing.
 *              Provides access to the Gemini client and conversation management.
 * 
 * @example
 * const { createLLMClient, createConversation } = require('./llm');
 * 
 * const client = createLLMClient({ apiKey: '...' });
 * const conversation = createConversation({ llmClient: client });
 */

'use strict';

const client = require('./client');
const conversation = require('./conversation');

module.exports = {
  // From client
  createLLMClient: client.createLLMClient,
  EventType: client.EventType,
  
  // From conversation
  createConversation: conversation.createConversation,
};
