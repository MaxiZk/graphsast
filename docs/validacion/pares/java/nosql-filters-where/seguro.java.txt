import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Filters;
import org.bson.Document;
import org.springframework.web.bind.annotation.*;

@RestController
public class NotaController {
    private MongoCollection<Document> notas;

    @GetMapping("/notas")
    public Object notas(@RequestParam String autor) {
        return notas.find(Filters.eq("autor", autor)).first();
    }
}
