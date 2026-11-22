from fastapi import FastAPI
from pydantic import BaseModel
app = FastAPI()
class User(BaseModel):
    id: int
    name: str
    avatar: str | None
@app.get('/api/users/me', response_model=User)
async def get_user():
    pass
