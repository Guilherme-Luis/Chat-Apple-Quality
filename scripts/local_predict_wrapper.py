#!/usr/bin/env python3
import sys, json, os
import joblib
import pandas as pd

def main():
    data = sys.stdin.read()
    try:
        payload = json.loads(data)
    except Exception:
        payload = {}
    record = payload.get("record", {})
    model_path = os.path.join('resources', 'artifacts', 'pipeline_full.joblib')
    if not os.path.exists(model_path):
        print(json.dumps({"error":"pipeline_full.joblib not found. Run npm start to build."}))
        return
    model = joblib.load(model_path)
    # ensure dataframe
    df = pd.DataFrame([record])
    try:
        preds = model.predict(df)
        out = {"prediction": int(preds[0])}
        if hasattr(model, "predict_proba"):
            out["proba"] = model.predict_proba(df).tolist()[0]
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
