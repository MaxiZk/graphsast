import com.mongodb.client.MongoCollection;
import org.bson.Document;
import org.springframework.web.bind.annotation.*;

@RestController
public class PedidoController {
    private MongoCollection<Document> pedidos;

    @PostMapping("/pedidos/buscar")
    public Object buscar(@RequestBody String filtro) {
        return pedidos.find(Document.parse(filtro)).first();
    }
}
