import pytest
from pydantic import ValidationError

from app.dashboards.models import DashboardDoc, ViewDef, validate_doc


def test_canvas_size_survives_document_round_trip():
    doc = DashboardDoc(views=[ViewDef(key="main", canvas={"width": 1920, "height": 1080})])
    restored = validate_doc(doc.model_dump(), heal=True)
    assert restored.views[0].canvas.width == 1920
    assert restored.views[0].canvas.height == 1080
    assert ViewDef(key="legacy").canvas is None


@pytest.mark.parametrize("value", [0, 159, 160.5, "1920", float("inf"), 9007199254740992])
def test_canvas_size_rejects_invalid_dimensions(value):
    with pytest.raises(ValidationError):
        ViewDef(key="main", canvas={"width": value, "height": 1080})
    with pytest.raises(ValidationError):
        ViewDef(key="main", canvas={"width": 1920, "height": value})
