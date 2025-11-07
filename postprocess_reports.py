#!/usr/bin/env python3
"""
postprocess_reports.py

Gera relatório/métricas/plots e salva previsões usando o modelo selecionado (best_model.joblib)
"""

import os
import json
import joblib
import pandas as pd
import numpy as np
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, classification_report
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

def ensure_dir(p): 
    if p: os.makedirs(p, exist_ok=True)

def load_model(path):
    d = joblib.load(path)
    # the train script saved {"model": clf, "features": feature_names}
    if isinstance(d, dict) and "model" in d:
        return d["model"], d.get("features", None)
    return d, None

def main():
    processed_csv = "resources/processed_apple_quality.csv"
    artifacts_dir = "resources/artifacts_models"
    best_model_path = os.path.join(artifacts_dir, "best_model.joblib")
    reports_dir = os.path.join(artifacts_dir, "reports")
    ensure_dir(reports_dir)

    if not os.path.exists(processed_csv):
        raise FileNotFoundError(processed_csv)
    if not os.path.exists(best_model_path):
        raise FileNotFoundError(best_model_path)

    df = pd.read_csv(processed_csv)
    label_col = "Quality_encoded"
    if label_col not in df.columns:
        raise ValueError(f"Label column {label_col} not found in {processed_csv}")

    X = df.drop(columns=[label_col])
    y_true = df[label_col].values

    model, features = load_model(best_model_path)

    # If the saved model expects a particular feature order or dummy cols, try to adapt:
    if features is not None:
        # reconstruct X with the correct columns (if some missing, fill zeros)
        X_df = pd.DataFrame(X)
        X_aligned = pd.DataFrame(0, index=X_df.index, columns=features)
        for c in X_df.columns:
            if c in X_aligned.columns:
                X_aligned[c] = X_df[c]
        X_used = X_aligned.values
    else:
        # fallback: convert to numeric matrix
        if not all(dtype.kind in 'iuf' for dtype in X.dtypes):
            X_used = pd.get_dummies(X).values
        else:
            X_used = X.values

    y_pred = model.predict(X_used)
    # probabilities (if available)
    probs = None
    if hasattr(model, "predict_proba"):
        probs = model.predict_proba(X_used).tolist()

    # metrics
    acc = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, average="weighted", zero_division=0)
    rec = recall_score(y_true, y_pred, average="weighted", zero_division=0)
    f1 = f1_score(y_true, y_pred, average="weighted", zero_division=0)
    report = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred)

    # save metrics
    metrics = {
        "accuracy": acc,
        "precision_weighted": prec,
        "recall_weighted": rec,
        "f1_weighted": f1,
        "classification_report": report
    }
    with open(os.path.join(reports_dir, "postprocess_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    # save predictions
    out_pred_df = X.copy()
    out_pred_df["y_true"] = y_true
    out_pred_df["y_pred"] = y_pred
    if probs is not None:
        # save probability for the positive class if binary, else all probs as JSON string
        out_pred_df["y_proba"] = [json.dumps(p) for p in probs]
    out_pred_df.to_csv(os.path.join(reports_dir, "predictions.csv"), index=False)
    out_pred_df.to_json(os.path.join(reports_dir, "predictions.json"), orient="records", force_ascii=False)

    # save confusion matrix plot
    plt.figure(figsize=(6,5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues")
    plt.title("Confusion Matrix")
    plt.xlabel("Predicted")
    plt.ylabel("True")
    plt.tight_layout()
    plt.savefig(os.path.join(reports_dir, "confusion_matrix.png"))
    plt.close()

    print(json.dumps({
        "status": "success",
        "metrics_file": os.path.join(reports_dir, "postprocess_metrics.json"),
        "predictions_csv": os.path.join(reports_dir, "predictions.csv"),
        "confusion_plot": os.path.join(reports_dir, "confusion_matrix.png")
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
