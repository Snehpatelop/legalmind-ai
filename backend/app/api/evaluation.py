from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import ai_rate_limit, rate_limit
from app.models import Document, Evaluation, EvaluationDataset, EvaluationQuestion, User
from app.schemas import EvalDatasetIn, EvalDatasetOut, EvalQuestionIn, EvalQuestionOut, EvalRunRequest, EvaluationOut
from app.services import evaluation as svc

router = APIRouter(prefix="/api/evaluation", tags=["evaluation"])


def _dataset(db: Session, user: User, dataset_id: str) -> EvaluationDataset:
    ds = db.scalar(select(EvaluationDataset).where(EvaluationDataset.id == dataset_id, EvaluationDataset.user_id == user.id))
    if ds is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@router.get("/datasets", response_model=list[EvalDatasetOut])
def list_datasets(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    return db.scalars(select(EvaluationDataset).where(EvaluationDataset.user_id == user.id)
                      .order_by(EvaluationDataset.created_at.desc())).all()


@router.post("/datasets", response_model=EvalDatasetOut, status_code=status.HTTP_201_CREATED)
def create_dataset(body: EvalDatasetIn, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    ds = EvaluationDataset(user_id=user.id, name=body.name.strip(), description=body.description, is_sample=False)
    ds.questions = [EvaluationQuestion(question=q.question.strip(), ground_truth=q.ground_truth.strip()) for q in body.questions]
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return ds


@router.post("/datasets/sample", response_model=EvalDatasetOut, status_code=status.HTTP_201_CREATED)
def create_sample_dataset(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    """Creates the sample dataset that matches the bundled sample contracts (clearly flagged as sample)."""
    ds = EvaluationDataset(user_id=user.id, name=svc.SAMPLE_DATASET["name"],
                           description=svc.SAMPLE_DATASET["description"], is_sample=True)
    ds.questions = [EvaluationQuestion(question=q, ground_truth=a) for q, a in svc.SAMPLE_DATASET["questions"]]
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return ds


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    db.delete(_dataset(db, user, dataset_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/datasets/{dataset_id}/questions", response_model=EvalQuestionOut, status_code=status.HTTP_201_CREATED)
def add_question(dataset_id: str, body: EvalQuestionIn, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    ds = _dataset(db, user, dataset_id)
    q = EvaluationQuestion(dataset_id=ds.id, question=body.question.strip(), ground_truth=body.ground_truth.strip())
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


@router.delete("/datasets/{dataset_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(dataset_id: str, question_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    ds = _dataset(db, user, dataset_id)
    q = db.scalar(select(EvaluationQuestion).where(EvaluationQuestion.id == question_id, EvaluationQuestion.dataset_id == ds.id))
    if q is None:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(q)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/run", response_model=EvaluationOut, status_code=status.HTTP_202_ACCEPTED)
def run_evaluation(body: EvalRunRequest, db: Session = Depends(get_db), user: User = Depends(ai_rate_limit)):
    ds = _dataset(db, user, body.dataset_id)
    if not ds.questions:
        raise HTTPException(status_code=400, detail="Add at least one question to the dataset first")
    doc_ids = None
    if body.document_ids:
        doc_ids = list(dict.fromkeys(body.document_ids))
        found = set(db.scalars(select(Document.id).where(Document.user_id == user.id, Document.id.in_(doc_ids))))
        if len(found) != len(doc_ids):
            raise HTTPException(status_code=404, detail="One or more selected documents were not found")
    if db.scalar(select(Evaluation.id).where(Evaluation.user_id == user.id, Evaluation.status == "running")):
        raise HTTPException(status_code=409, detail="An evaluation is already running. Wait for it to finish.")
    ev = Evaluation(user_id=user.id, dataset_id=ds.id, dataset_name=ds.name, is_sample=ds.is_sample, status="running",
                    metric_results={"progress": {"done": 0, "total": len(ds.questions), "stage": "queued"}})
    db.add(ev)
    db.commit()
    db.refresh(ev)
    svc.submit(ev.id, doc_ids)
    return ev


@router.get("/results", response_model=list[EvaluationOut])
def results(db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    return db.scalars(select(Evaluation).where(Evaluation.user_id == user.id).order_by(Evaluation.created_at.desc())).all()


@router.get("/results/{evaluation_id}", response_model=EvaluationOut)
def result(evaluation_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    ev = db.scalar(select(Evaluation).where(Evaluation.id == evaluation_id, Evaluation.user_id == user.id))
    if ev is None:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return ev


@router.delete("/results/{evaluation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_result(evaluation_id: str, db: Session = Depends(get_db), user: User = Depends(rate_limit)):
    ev = db.scalar(select(Evaluation).where(Evaluation.id == evaluation_id, Evaluation.user_id == user.id))
    if ev is None:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    if ev.status == "running":
        raise HTTPException(status_code=409, detail="Cannot delete a running evaluation")
    db.delete(ev)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
