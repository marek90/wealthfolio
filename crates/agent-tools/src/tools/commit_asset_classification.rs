//! Commit Asset Classification tool (MCP-only).
//!
//! `commit_asset_classification_draft` takes the reviewed assignment shape
//! produced by `prepare_asset_classification` and persists it through the same
//! taxonomy replacement service the in-app confirmation widget uses.

use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use wealthfolio_core::taxonomies::{AssetTaxonomyAssignment, NewAssetTaxonomyAssignment};

use crate::env::AgentEnvironment;
use crate::scope::AgentScope;
use crate::tool::{AgentTool, AgentToolAccess, AgentToolError, AgentToolResult};

const AI_ASSIGNMENT_SOURCE: &str = "ai";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitAssetClassificationAssignmentInput {
    pub category_id: String,
    pub weight_basis_points: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitAssetClassificationDraftArgs {
    pub asset_id: String,
    pub taxonomy_id: String,
    pub assignments: Vec<CommitAssetClassificationAssignmentInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommittedAssetClassificationAssignment {
    pub assignment_id: String,
    pub asset_id: String,
    pub taxonomy_id: String,
    pub category_id: String,
    pub weight_basis_points: i32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitAssetClassificationDraftOutput {
    pub draft_status: String,
    pub asset_id: String,
    pub taxonomy_id: String,
    pub assignment_count: usize,
    pub assignments: Vec<CommittedAssetClassificationAssignment>,
    pub applied_at: String,
}

fn build_new_assignments(
    asset_id: &str,
    taxonomy_id: &str,
    assignments: Vec<CommitAssetClassificationAssignmentInput>,
) -> Result<Vec<NewAssetTaxonomyAssignment>, AgentToolError> {
    let asset_id = asset_id.trim();
    if asset_id.is_empty() {
        return Err(AgentToolError::InvalidInput(
            "assetId is required".to_string(),
        ));
    }

    let taxonomy_id = taxonomy_id.trim();
    if taxonomy_id.is_empty() {
        return Err(AgentToolError::InvalidInput(
            "taxonomyId is required".to_string(),
        ));
    }

    assignments
        .into_iter()
        .map(|assignment| {
            let category_id = assignment.category_id.trim();
            if category_id.is_empty() {
                return Err(AgentToolError::InvalidInput(
                    "categoryId is required".to_string(),
                ));
            }

            Ok(NewAssetTaxonomyAssignment {
                id: None,
                asset_id: asset_id.to_string(),
                taxonomy_id: taxonomy_id.to_string(),
                category_id: category_id.to_string(),
                weight: assignment.weight_basis_points,
                source: AI_ASSIGNMENT_SOURCE.to_string(),
            })
        })
        .collect()
}

fn committed_assignment_dto(
    assignment: AssetTaxonomyAssignment,
) -> CommittedAssetClassificationAssignment {
    CommittedAssetClassificationAssignment {
        assignment_id: assignment.id,
        asset_id: assignment.asset_id,
        taxonomy_id: assignment.taxonomy_id,
        category_id: assignment.category_id,
        weight_basis_points: assignment.weight,
        source: assignment.source,
    }
}

/// Commit a reviewed asset classification draft.
pub struct CommitAssetClassificationDraft;

#[async_trait::async_trait]
impl AgentTool for CommitAssetClassificationDraft {
    fn name(&self) -> &'static str {
        "commit_asset_classification_draft"
    }

    fn description(&self) -> &'static str {
        "Persist a reviewed asset classification draft produced by \
         prepare_asset_classification. This MUTATES data — only call it after \
         the user has reviewed and confirmed the draft. Use assetId from \
         resolvedAsset.assetId, or from the chosen asset candidate when the \
         draft required asset selection. The assignments replace all current \
         assignments for the selected asset and taxonomy; pass an empty array \
         only when the user confirmed clearing that taxonomy."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "assetId": {
                    "type": "string",
                    "description": "Asset ID from prepare_asset_classification.resolvedAsset.assetId, or the chosen asset candidate ID."
                },
                "taxonomyId": {
                    "type": "string",
                    "description": "Taxonomy ID from prepare_asset_classification.taxonomy.taxonomyId."
                },
                "assignments": {
                    "type": "array",
                    "description": "Reviewed proposed assignments from prepare_asset_classification.proposedAssignments. This array replaces every current assignment for the asset and taxonomy; [] clears the taxonomy.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "categoryId": { "type": "string" },
                            "weightBasisPoints": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 10000
                            }
                        },
                        "required": ["categoryId", "weightBasisPoints"]
                    }
                }
            },
            "required": ["assetId", "taxonomyId", "assignments"]
        })
    }

    fn required_scopes(&self) -> &'static [AgentScope] {
        &[
            AgentScope::ClassificationSuggest,
            AgentScope::ClassificationWrite,
        ]
    }

    fn access_level(&self) -> AgentToolAccess {
        AgentToolAccess::Write
    }

    async fn call(
        &self,
        env: Arc<dyn AgentEnvironment>,
        args: serde_json::Value,
    ) -> Result<AgentToolResult, AgentToolError> {
        let args: CommitAssetClassificationDraftArgs = serde_json::from_value(args)?;
        let asset_id = args.asset_id.trim().to_string();
        let taxonomy_id = args.taxonomy_id.trim().to_string();
        let assignments = build_new_assignments(&asset_id, &taxonomy_id, args.assignments)?;

        let replaced = env
            .taxonomy_service()
            .replace_asset_taxonomy_assignments(&asset_id, &taxonomy_id, assignments)
            .await
            .map_err(|e| AgentToolError::ExecutionFailed(e.to_string()))?;
        env.health_service().clear_cache().await;

        let assignments = replaced
            .into_iter()
            .map(committed_assignment_dto)
            .collect::<Vec<_>>();
        let output = CommitAssetClassificationDraftOutput {
            draft_status: "applied".to_string(),
            asset_id,
            taxonomy_id,
            assignment_count: assignments.len(),
            assignments,
            applied_at: Utc::now().to_rfc3339(),
        };
        Ok(AgentToolResult {
            content: serde_json::to_value(output)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_reviewed_assignments_to_replacement_payload() {
        let assignments = build_new_assignments(
            " asset-1 ",
            " sector ",
            vec![CommitAssetClassificationAssignmentInput {
                category_id: "technology".to_string(),
                weight_basis_points: 7500,
            }],
        )
        .unwrap();

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].asset_id, "asset-1");
        assert_eq!(assignments[0].taxonomy_id, "sector");
        assert_eq!(assignments[0].category_id, "technology");
        assert_eq!(assignments[0].weight, 7500);
        assert_eq!(assignments[0].source, AI_ASSIGNMENT_SOURCE);
        assert!(assignments[0].id.is_none());
    }

    #[test]
    fn empty_assignments_are_allowed_for_confirmed_clears() {
        let assignments = build_new_assignments("asset-1", "sector", Vec::new()).unwrap();
        assert!(assignments.is_empty());
    }

    #[test]
    fn blank_asset_or_taxonomy_is_rejected() {
        assert!(matches!(
            build_new_assignments(" ", "sector", Vec::new()),
            Err(AgentToolError::InvalidInput(_))
        ));
        assert!(matches!(
            build_new_assignments("asset-1", " ", Vec::new()),
            Err(AgentToolError::InvalidInput(_))
        ));
    }

    #[test]
    fn blank_category_is_rejected() {
        assert!(matches!(
            build_new_assignments(
                "asset-1",
                "sector",
                vec![CommitAssetClassificationAssignmentInput {
                    category_id: " ".to_string(),
                    weight_basis_points: 10000,
                }],
            ),
            Err(AgentToolError::InvalidInput(_))
        ));
    }
}
